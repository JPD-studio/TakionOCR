import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { createWorker } from 'tesseract.js';
import { ConfigManager } from './config-manager';
import { UsageManager } from './usage-manager';
import { FileValidator } from './file-validator';
import { RetryManager } from './retry-manager';
import { MetricsService } from './metrics-service';
import { Logger } from './logger';
import { OcrError } from './errors';
import { ErrorType, OcrConfig, OcrResult } from './types';

export class OcrProcessor {
  private s3Client = new S3Client({});
  private textractClient = new TextractClient({});
  private configManager = new ConfigManager();
  private usageManager: UsageManager;
  private fileValidator = new FileValidator();
  private retryManager = new RetryManager();
  private metricsService = new MetricsService();
  
  constructor(private logger: Logger) {
    this.usageManager = new UsageManager(logger);
  }
  
  async processFile(bucket: string, key: string): Promise<void> {
    try {
      const config = await this.configManager.getConfig();
      
      const fileBuffer = await this.getFileFromS3(bucket, key);
      await this.fileValidator.validateFile(fileBuffer);
      
      const pageCount = await this.fileValidator.getPageCount(fileBuffer);
      await this.usageManager.checkUsageLimit(pageCount);
      
      const result = await this.performOcr(fileBuffer, config);
      
      await this.saveResult(key, result);
      await this.usageManager.updateUsage(pageCount);
      
      await this.metricsService.recordProcessingTime(
        result.engine,
        result.pageCount,
        result.processingTime
      );
      
    } catch (error) {
      await this.handleError(key, error as Error);
      throw error;
    }
  }
  
  private async getFileFromS3(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await this.s3Client.send(command);
    const chunks: Uint8Array[] = [];
    
    if (response.Body) {
      const stream = response.Body as any;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    }
    
    return Buffer.concat(chunks);
  }
  
  private async performOcr(fileBuffer: Buffer, config: OcrConfig): Promise<OcrResult> {
    const startTime = Date.now();
    
    try {
      if (config.textractEnabled) {
        return await this.performTextractOcr(fileBuffer, config, startTime);
      } else if (config.tesseractEnabled) {
        return await this.performTesseractOcr();
      } else {
        throw new OcrError(
          ErrorType.CONFIGURATION_ERROR,
          'No OCR engine is enabled'
        );
      }
    } finally {
      const duration = Date.now() - startTime;
      this.logger.info('OCR processing completed', { duration });
    }
  }
  
  private async performTextractOcr(fileBuffer: Buffer, config: OcrConfig, startTime: number): Promise<OcrResult> {
    const command = new DetectDocumentTextCommand({
      Document: {
        Bytes: fileBuffer
      }
    });
    
    const response = await this.retryManager.executeWithRetry(
      () => this.textractClient.send(command),
      config.maxRetryAttempts,
      config.ocrTimeout * 1000
    );
    
    const extractedText = response.Blocks
      ?.filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n') || '';
    
    return {
      success: true,
      engine: 'textract',
      text: extractedText,
      confidence: this.calculateAverageConfidence(response.Blocks || []),
      pageCount: await this.fileValidator.getPageCount(fileBuffer),
      processingTime: Date.now() - startTime
    };
  }
  
  private async performTesseractOcr(): Promise<OcrResult> {
    const worker = await createWorker();
    
    try {
      await worker.loadLanguage('jpn+eng');
      await worker.initialize('jpn+eng');
      
      throw new OcrError(
        ErrorType.OCR_ENGINE_ERROR,
        'Tesseract OCR requires PDF to image conversion implementation',
        false
      );
    } finally {
      await worker.terminate();
    }
  }
  
  private calculateAverageConfidence(blocks: any[]): number {
    if (!blocks || blocks.length === 0) return 0;
    
    const confidenceValues = blocks
      .filter(block => block.Confidence !== undefined)
      .map(block => block.Confidence);
    
    if (confidenceValues.length === 0) return 0;
    
    return confidenceValues.reduce((sum, conf) => sum + conf, 0) / confidenceValues.length;
  }
  
  private async saveResult(key: string, result: OcrResult): Promise<void> {
    const outputBucket = process.env.S3_OUTPUT_BUCKET!;
    const outputKey = key.replace('input/', 'output/').replace('.pdf', '.json');
    
    const command = new PutObjectCommand({
      Bucket: outputBucket,
      Key: outputKey,
      Body: JSON.stringify(result, null, 2),
      ContentType: 'application/json'
    });
    
    await this.s3Client.send(command);
  }
  
  private async handleError(key: string, error: Error): Promise<void> {
    this.logger.error('OCR processing failed', { key, error: error.message });
    
    if (error instanceof OcrError) {
      await this.metricsService.recordError(error.type);
    } else {
      await this.metricsService.recordError('UNKNOWN_ERROR');
    }
  }
}
