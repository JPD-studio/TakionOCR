import { S3Event, Context } from 'aws-lambda';
import { LambdaOcrProcessor } from './lambda-ocr-processor';
import { Logger } from './logger';

export const handler = async (event: S3Event, context: Context): Promise<void> => {
  const logger = new Logger(context.awsRequestId);
  
  try {
    const records = event.Records;
    
    for (const record of records) {
      const inputBucket = record.s3.bucket.name;
      const inputKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      // Generate output key (same bucket, different prefix)
      const outputBucket = process.env.OUTPUT_BUCKET || inputBucket;
      const outputKey = `processed/${inputKey.replace(/\.[^/.]+$/, '')}-result.json`;
      
      logger.info('Processing started', { inputBucket, inputKey, outputBucket, outputKey });
      
      const processor = new LambdaOcrProcessor(logger);
      await processor.processS3File(inputBucket, inputKey, outputBucket, outputKey);
      
      logger.info('Processing completed', { inputBucket, inputKey });
    }
  } catch (error) {
    logger.error('Lambda execution failed', { error: (error as Error).message });
    throw error;
  }
};
