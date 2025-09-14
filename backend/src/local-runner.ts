import * as dotenv from 'dotenv';
import { S3Event, Context } from 'aws-lambda';
import { handler } from './lambda-handler';

dotenv.config({ path: '.env.local' });

async function runLocal(): Promise<void> {
  const mockEvent: S3Event = {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: new Date().toISOString(),
        eventName: 's3:ObjectCreated:Put',
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test-config',
          bucket: {
            name: process.env.S3_INPUT_BUCKET || 'test-bucket',
            ownerIdentity: { principalId: 'test' },
            arn: 'arn:aws:s3:::test-bucket'
          },
          object: {
            key: 'input/test.pdf',
            size: 1024,
            eTag: 'test-etag',
            sequencer: 'test-sequencer'
          }
        }
      } as any
    ]
  };

  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'takion-ocr-local',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:takion-ocr-local',
    memoryLimitInMB: '1024',
    awsRequestId: 'local-' + Date.now(),
    logGroupName: '/aws/lambda/takion-ocr-local',
    logStreamName: '2023/09/14/[$LATEST]local',
    getRemainingTimeInMillis: () => 300000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };

  try {
    await handler(mockEvent, mockContext);
    console.log('Local execution completed successfully');
  } catch (error) {
    console.error('Local execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runLocal();
}
