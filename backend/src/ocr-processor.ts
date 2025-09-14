import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand, Block } from '@aws-sdk/client-textract';
import * as pdf2pic from 'pdf2pic';
import { readFileSync, writeFileSync } from 'fs';
import { ConfigManager } from './config-manager';
import { RetryManager } from './retry-manager';
import { MetricsService } from './metrics-service';
import { Logger } from './logger';
import { 
  OcrResult, 
  OcrConfig,
  TableCell,
  Table
} from './types';

export class OcrProcessor {
  private s3Client = new S3Client({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  });
  private textractClient = new TextractClient({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  });
  private configManager = new ConfigManager();
  private retryManager = new RetryManager();
  private metricsService = new MetricsService();
  
  constructor(private logger: Logger) {
  }

  async processFile(inputKey: string, outputKey: string): Promise<OcrResult> {
    try {
      this.logger.info('Starting OCR processing', { inputKey, outputKey });
      
      // Get file from S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: process.env.S3_INPUT_BUCKET,
        Key: inputKey
      });
      
      const response = await this.s3Client.send(getObjectCommand);
      
      if (!response.Body) {
        throw new Error('File not found in S3');
      }
      
      // Convert stream to buffer
      const stream = response.Body as any;
      const chunks: Uint8Array[] = [];
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      const fileBuffer = Buffer.concat(chunks);
      
      // Validate file
      // await this.fileValidator.validate(fileBuffer, inputKey);
      
      // Get OCR configuration
      const config = await this.configManager.getConfig();
      
      // Process with OCR
      const result = await this.performOcr(fileBuffer, config);
      
      // Save result to S3
      const putObjectCommand = new PutObjectCommand({
        Bucket: process.env.S3_OUTPUT_BUCKET,
        Key: outputKey,
        Body: JSON.stringify(result, null, 2),
        ContentType: 'application/json'
      });
      
      await this.s3Client.send(putObjectCommand);
      
      this.logger.info('OCR processing completed successfully', { 
        inputKey, 
        outputKey,
        pageCount: result.pageCount,
        processingTimeMs: result.processingTimeMs
      });
      
      return result;
    } catch (error) {
      await this.handleError(inputKey, error as Error);
      throw error;
    }
  }

  async processLocalFile(filePath: string, outputPath: string, engine?: string): Promise<OcrResult> {
    try {
      this.logger.info('Starting local OCR processing', { filePath, outputPath });
      
      const fileBuffer = readFileSync(filePath);
      const config = await this.configManager.getConfig();
      
      // Set engine type if specified
      if (engine) {
        (config as any).engineType = engine;
      }
      
      // await this.fileValidator.validate(fileBuffer, filePath);
      
      const result = await this.performOcr(fileBuffer, config);
      
      writeFileSync(outputPath, JSON.stringify(result, null, 2));
      
      this.logger.info('Local OCR processing completed', { filePath, outputPath });
      
      return result;
    } catch (error) {
      await this.handleError(filePath, error as Error);
      throw error;
    }
  }
  
  private async performOcr(fileBuffer: Buffer, config: OcrConfig): Promise<OcrResult> {
    const startTime = Date.now();
    
    try {
      // エンジンタイプを明示的にチェック
      const engineType = (config as any).engineType || 'textract';
      
      if (engineType === 'textract-analyze') {
        return await this.performTextractAnalyzeOcr(fileBuffer, config, startTime);
      } else if (engineType === 'textract') {
        return await this.performTextractOcr(fileBuffer, config, startTime);
      } else {
        throw new Error('Unsupported OCR engine. Use textract or textract-analyze.');
      }
    } finally {
      const duration = Date.now() - startTime;
      this.logger.info('OCR processing completed', { duration });
    }
  }

  private async performTextractOcr(fileBuffer: Buffer, config: OcrConfig, startTime: number): Promise<OcrResult> {
    // TextractはPDFを直接サポートしないので、画像に変換
    let imageBuffers: Buffer[];
    
    if (this.isPdf(fileBuffer)) {
      // PDFを超高解像度で画像に変換（図面専用最適化）
      const convert = pdf2pic.fromBuffer(fileBuffer, {
        density: 1200,  // 図面用に高解像度
        saveFilename: "temp",
        savePath: "/tmp/",
        format: "png",
        width: 3508,    // A3サイズ対応
        height: 4961,   // A3サイズ対応
        quality: 100    // 最高品質
      });
      
      const pages = await convert.bulk(-1, { responseType: "buffer" });
      imageBuffers = pages.map(page => page.buffer!).filter(Boolean);
    } else {
      // すでに画像の場合はそのまま使用
      imageBuffers = [fileBuffer];
    }
    
    // 各ページに対してTextractを実行
    const pageResults: Array<{ text: string; confidence: number; blockCount: number }> = [];
    
    for (let i = 0; i < imageBuffers.length; i++) {
      const command = new DetectDocumentTextCommand({
        Document: {
          Bytes: imageBuffers[i]
        }
      });
      
      const response = await this.retryManager.executeWithRetry(
        () => this.textractClient.send(command),
        config.maxRetryAttempts,
        config.ocrTimeout * 1000
      );
      
      const pageText = response.Blocks
        ?.filter(block => block.BlockType === 'LINE')
        .map(block => block.Text)
        .join('\n') || '';
      
      pageResults.push({
        text: pageText,
        confidence: this.calculateAverageConfidence(response.Blocks || []),
        blockCount: response.Blocks?.length || 0
      });
    }
    
    return {
      engine: 'textract',
      inputFile: 'local.pdf',
      fileSize: fileBuffer.length,
      pageCount: pageResults.length,
      processingTimeMs: Date.now() - startTime,
      pages: pageResults.map((result, index) => ({
        pageNumber: index + 1,
        text: result.text,
        confidence: result.confidence,
        blockCount: result.blockCount
      })),
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
      }
    };
  }
  
  private isPdf(buffer: Buffer): boolean {
    return buffer.length > 4 && buffer.toString('ascii', 0, 4) === '%PDF';
  }

  private async performTextractAnalyzeOcr(fileBuffer: Buffer, config: OcrConfig, startTime: number): Promise<OcrResult> {
    // TextractはPDFを直接サポートしないので、画像に変換
    let imageBuffers: Buffer[];
    
    if (this.isPdf(fileBuffer)) {
      // PDFを超高解像度で画像に変換
      const convert = pdf2pic.fromBuffer(fileBuffer, {
        density: 1200,
        saveFilename: "temp",
        savePath: "/tmp/",
        format: "png",
        width: 3508,
        height: 4961,
        quality: 100
      });
      
      const pages = await convert.bulk(-1, { responseType: "buffer" });
      imageBuffers = pages.map(page => page.buffer!).filter(Boolean);
    } else {
      imageBuffers = [fileBuffer];
    }

    // 各ページに対してTextract Analyzeを実行
    const pageResults: Array<{ 
      text: string; 
      confidence: number; 
      blockCount: number;
      keyValuePairs: Array<{key: string, value: string}>;
      tables: Table[];
    }> = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      const command = new AnalyzeDocumentCommand({
        Document: { Bytes: imageBuffers[i] },
        FeatureTypes: ['FORMS', 'TABLES']
      });

      const response = await this.retryManager.executeWithRetry(
        () => this.textractClient.send(command),
        config.maxRetryAttempts,
        config.ocrTimeout * 1000
      );
      
      const pageText = response.Blocks
        ?.filter(block => block.BlockType === 'LINE')
        .map(block => block.Text)
        .join('\n') || '';
      
      const keyValuePairs = this.extractKeyValuePairs(response.Blocks || []);
      const tables = this.extractTables(response.Blocks || []);
      
      pageResults.push({
        text: pageText,
        confidence: this.calculateAverageConfidence(response.Blocks || []),
        blockCount: response.Blocks?.length || 0,
        keyValuePairs,
        tables
      });
    }

    // 全ページの結果をまとめる
    const allKeyValuePairs = pageResults.flatMap(result => result.keyValuePairs);
    const allTables = pageResults.flatMap(result => result.tables);

    return {
      engine: 'textract-analyze',
      inputFile: 'local.pdf',
      fileSize: fileBuffer.length,
      pageCount: pageResults.length,
      processingTimeMs: Date.now() - startTime,
      pages: pageResults.map((result, index) => ({
        pageNumber: index + 1,
        text: result.text,
        confidence: result.confidence,
        blockCount: result.blockCount,
        ...(result.keyValuePairs.length > 0 && { forms: result.keyValuePairs }),
        ...(result.tables.length > 0 && { tables: result.tables })
      })),
      forms: allKeyValuePairs,
      tables: allTables,
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
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
      let rows: string[][] | undefined = undefined;
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

  tables.push({ cells, rows: rows || [] });
    });

    return tables;
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
    this.logger.error('OCR processing failed', { key, error: error.message });
    await this.metricsService.recordError('PROCESSING_ERROR');
  }
}
