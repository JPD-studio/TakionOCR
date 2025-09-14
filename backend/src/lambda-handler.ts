import { S3Event, Context } from 'aws-lambda';
import { OcrProcessor } from './ocr-processor';
import { Logger } from './logger';

export const handler = async (event: S3Event, context: Context): Promise<void> => {
  const logger = new Logger(context.awsRequestId);
  
  try {
    const records = event.Records;
    
    for (const record of records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      logger.info('Processing started', { bucket, key });
      
      const processor = new OcrProcessor(logger);
      await processor.processFile(bucket, key);
      
      logger.info('Processing completed', { bucket, key });
    }
  } catch (error) {
    logger.error('Lambda execution failed', { error: (error as Error).message });
    throw error;
  }
};
