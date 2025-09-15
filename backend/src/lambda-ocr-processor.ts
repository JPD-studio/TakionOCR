import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { 
  TextractClient, 
  StartDocumentAnalysisCommand, 
  GetDocumentAnalysisCommand,
  Block 
} from '@aws-sdk/client-textract';
import { ConfigManager } from './config-manager';
import { RetryManager } from './retry-manager';
import { MetricsService } from './metrics-service';
import { Logger } from './logger';
import { RekognitionShapeDetector } from './rekognition-shape-detector';
import { PdfImageConverter } from './pdf-image-converter';
import { 
  OcrResult, 
  OcrConfig,
  TableCell,
  Table,
  PageShapeAnalysis
} from './types';

export class LambdaOcrProcessor {
  private s3Client = new S3Client({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  });
  private textractClient = new TextractClient({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  });
  private configManager = new ConfigManager();
  private retryManager = new RetryManager();
  private metricsService = new MetricsService();
  
  constructor(private logger: Logger) {}

  async processS3File(inputBucket: string, inputKey: string, outputBucket?: string, outputKey?: string): Promise<OcrResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting S3-based OCR processing', { inputBucket, inputKey });
      
      // Get file metadata from S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: inputBucket,
        Key: inputKey
      });
      
      const response = await this.s3Client.send(getObjectCommand);
      const fileSize = response.ContentLength || 0;
      
      // Get OCR configuration
      const config = await this.configManager.getConfig();
      
      // Start document analysis (async)
      const startAnalysisCommand = new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: inputBucket,
            Name: inputKey
          }
        },
        FeatureTypes: ['FORMS', 'TABLES']
      });
      
      const startResponse = await this.retryManager.executeWithRetry(
        () => this.textractClient.send(startAnalysisCommand),
        config.maxRetryAttempts,
        config.ocrTimeout * 1000
      );
      
      if (!startResponse.JobId) {
        throw new Error('Failed to start Textract analysis job');
      }
      
      this.logger.info('Textract analysis job started', { jobId: startResponse.JobId });
      
      // Poll for completion
      const analysisResult = await this.pollForAnalysisCompletion(
        startResponse.JobId, 
        config.ocrTimeout * 1000
      );
      
      // Process results
      const result = await this.processTextractBlocks(
        analysisResult.blocks, 
        inputKey, 
        fileSize, 
        startTime,
        config,
        inputBucket,
        inputKey
      );      // Save result to S3 if output location specified
      if (outputBucket && outputKey) {
        const putObjectCommand = new PutObjectCommand({
          Bucket: outputBucket,
          Key: outputKey,
          Body: JSON.stringify(result, null, 2),
          ContentType: 'application/json'
        });
        
        await this.s3Client.send(putObjectCommand);
        this.logger.info('Results saved to S3', { outputBucket, outputKey });
      }
      
      this.logger.info('S3-based OCR processing completed', { 
        inputBucket,
        inputKey,
        processingTimeMs: result.processingTimeMs
      });
      
      return result;
      
    } catch (error) {
      await this.handleError(inputKey, error as Error);
      throw error;
    }
  }

  private async pollForAnalysisCompletion(jobId: string, timeoutMs: number): Promise<{blocks: Block[]}> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    
    while (Date.now() - startTime < timeoutMs) {
      const getCommand = new GetDocumentAnalysisCommand({ JobId: jobId });
      const response = await this.textractClient.send(getCommand);
      
      this.logger.info('Polling analysis job', { 
        jobId, 
        status: response.JobStatus,
        elapsedMs: Date.now() - startTime 
      });
      
      if (response.JobStatus === 'SUCCEEDED') {
        const allBlocks: Block[] = [];
        
        // Get all pages of results
        let nextToken = response.NextToken;
        allBlocks.push(...(response.Blocks || []));
        
        while (nextToken) {
          const nextCommand = new GetDocumentAnalysisCommand({ 
            JobId: jobId, 
            NextToken: nextToken 
          });
          const nextResponse = await this.textractClient.send(nextCommand);
          allBlocks.push(...(nextResponse.Blocks || []));
          nextToken = nextResponse.NextToken;
        }
        
        return { blocks: allBlocks };
        
      } else if (response.JobStatus === 'FAILED') {
        throw new Error(`Textract analysis job failed: ${response.StatusMessage}`);
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`Textract analysis job timed out after ${timeoutMs}ms`);
  }

  private async processTextractBlocks(
    blocks: Block[], 
    inputFile: string, 
    fileSize: number, 
    startTime: number,
    config: OcrConfig,
    inputBucket: string,
    inputKey: string
  ): Promise<OcrResult> {
    // 図形検出が有効な場合、PDF→画像変換→図形検出を実行
    let pageShapeAnalyses: PageShapeAnalysis[] = [];
    
    if (config.rekognitionEnabled) {
      try {
        this.logger.info('Starting integrated shape detection', { inputFile });
        
        // S3からPDFファイルを取得
        const getObjectCommand = new GetObjectCommand({
          Bucket: inputBucket,
          Key: inputKey
        });
        const response = await this.s3Client.send(getObjectCommand);
        const fileBuffer = await response.Body?.transformToByteArray();
        
        if (fileBuffer) {
          // PDF→画像変換（OCRと同じタイミングで実行）
          const pdfConverter = new PdfImageConverter(this.logger);
          const pageImages = await pdfConverter.convertPdfToImages(Buffer.from(fileBuffer), {
            density: 150,    // Rekognition用最適化
            format: 'png',   // Rekognition対応フォーマット
            width: 1024,
            height: 1024
          });
          
          // 変換した画像で図形検出実行
          const shapeDetector = new RekognitionShapeDetector(this.logger);
          pageShapeAnalyses = await shapeDetector.analyzePageImages(pageImages);
          
          this.logger.info('Shape detection completed', { 
            inputFile,
            pagesProcessed: pageShapeAnalyses.length,
            shapesDetected: pageShapeAnalyses.reduce((total, page) => total + page.shape_count, 0)
          });
        }
      } catch (error) {
        this.logger.warn('Shape detection failed, continuing with OCR only', { 
          inputFile, 
          error: (error as Error).message 
        });
        // 図形検出失敗時はフォールバック結果で継続
      }
    }

    // Textractのページ処理（従来通り）
    const pageBlocks = blocks.filter(block => block.BlockType === 'PAGE');
    const pageResults = pageBlocks.map((pageBlock, index) => {
      const pageNumber = pageBlock.Page || (index + 1);
      
      // Get lines for this page
      const pageLines = blocks.filter(block => 
        block.BlockType === 'LINE' && 
        block.Page === pageNumber
      );
      
      // Get forms for this page
      const pageForms = this.extractKeyValuePairsForPage(blocks, pageNumber);
      
      // Get tables for this page  
      const pageTables = this.extractTablesForPage(blocks, pageNumber);
      
      const pageText = pageLines.map(line => line.Text).join('\n');
      const confidence = this.calculateAverageConfidence(pageLines);
      
      // 対応するページの図形検出結果を取得
      const shapes = pageShapeAnalyses[index] || undefined;
      
      return {
        pageNumber: index + 1,
        text: pageText,
        confidence,
        blockCount: pageLines.length,
        ...(pageForms.length > 0 && { forms: pageForms }),
        ...(pageTables.length > 0 && { tables: pageTables }),
        ...(shapes && { shapes })
      };
    });
    
    // Extract forms and tables (all pages combined for backward compatibility)
    const keyValuePairs = this.extractKeyValuePairs(blocks);
    const tables = this.extractTables(blocks);
    
    return {
      engine: 'textract-analyze',
      inputFile,
      fileSize,
      pageCount: pageResults.length,
      processingTimeMs: Date.now() - startTime,
      pages: pageResults,
      forms: keyValuePairs,
      tables,
      metadata: {
        timestamp: new Date().toISOString(),
        version: '3.0.0',  // v3.0に更新
        region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
      }
    };
  }

  private extractKeyValuePairs(blocks: Block[]): Array<{key: string, value: string}> {
    const keyValuePairs: Array<{key: string, value: string}> = [];
    const keyMap = new Map<string, Block>();
    const valueMap = new Map<string, Block>();
    const blockMap = new Map<string, Block>();

    blocks.forEach(block => {
      blockMap.set(block.Id!, block);
      if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
        keyMap.set(block.Id!, block);
      } else if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('VALUE')) {
        valueMap.set(block.Id!, block);
      }
    });

    keyMap.forEach((keyBlock) => {
      const valueBlock = keyBlock.Relationships?.find(rel => rel.Type === 'VALUE')?.Ids?.map(id => valueMap.get(id))[0];
      const keyText = this.getTextForBlock(keyBlock, blockMap);
      const valueText = valueBlock ? this.getTextForBlock(valueBlock, blockMap) : '';
      if (keyText) {
        keyValuePairs.push({ key: keyText, value: valueText });
      }
    });

    return keyValuePairs;
  }

  private extractKeyValuePairsForPage(blocks: Block[], pageNumber: number): Array<{key: string, value: string}> {
    const pageBlocks = blocks.filter(block => block.Page === pageNumber);
    return this.extractKeyValuePairs(pageBlocks);
  }

  private extractTables(blocks: Block[]): Table[] {
    const tables: Table[] = [];
    const blockMap = new Map<string, Block>();
    
    blocks.forEach(block => {
      blockMap.set(block.Id!, block);
    });

    const tableBlocks = blocks.filter(block => block.BlockType === 'TABLE');
    tableBlocks.forEach(tableBlock => {
      const cellBlocks = tableBlock.Relationships?.find(rel => rel.Type === 'CHILD')?.Ids?.map(id => blockMap.get(id)) || [];
      const cells: TableCell[] = [];

      cellBlocks.forEach(cellBlock => {
        if (cellBlock && cellBlock.BlockType === 'CELL') {
          const cellText = this.getTextForBlock(cellBlock, blockMap);
          cells.push({
            text: cellText,
            rowIndex: cellBlock.RowIndex || 0,
            columnIndex: cellBlock.ColumnIndex || 0
          });
        }
      });

      // Build 2D rows representation from cells
      let rows: string[][] = [];
      if (cells.length > 0) {
        const maxRow = Math.max(...cells.map(c => c.rowIndex || 0));
        const maxCol = Math.max(...cells.map(c => c.columnIndex || 0));

        if (maxRow > 0 && maxCol > 0) {
          rows = Array.from({ length: maxRow }, () => Array.from({ length: maxCol }, () => ''));
          for (const c of cells) {
            const r = (c.rowIndex || 0) - 1;
            const co = (c.columnIndex || 0) - 1;
            if (r >= 0 && co >= 0 && r < rows.length && co < rows[r].length) {
              rows[r][co] = c.text || '';
            }
          }
        }
      }

      tables.push({ cells, rows });
    });

    return tables;
  }

  private extractTablesForPage(blocks: Block[], pageNumber: number): Table[] {
    const pageBlocks = blocks.filter(block => block.Page === pageNumber);
    return this.extractTables(pageBlocks);
  }

  private getTextForBlock(block: Block, blockMap: Map<string, Block>): string {
    if (!block.Relationships) return '';
    return block.Relationships.filter(rel => rel.Type === 'CHILD')
      .flatMap(rel => rel.Ids?.map(id => blockMap.get(id)?.Text || '') || [])
      .join(' ');
  }

  private calculateAverageConfidence(blocks: Block[]): number {
    if (!blocks || blocks.length === 0) return 0;
    
    const confidenceBlocks = blocks.filter(block => 
      block.Confidence !== undefined && block.BlockType === 'LINE'
    );
    
    if (confidenceBlocks.length === 0) return 0;
    
    const totalConfidence = confidenceBlocks.reduce(
      (sum, block) => sum + (block.Confidence || 0), 0
    );
    
    return totalConfidence / confidenceBlocks.length;
  }

  private async handleError(key: string, error: Error): Promise<void> {
    this.logger.error('S3 OCR processing failed', { key, error: error.message });
    await this.metricsService.recordError('PROCESSING_ERROR');
  }
}
