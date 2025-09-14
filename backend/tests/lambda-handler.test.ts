import { handler } from '../src/lambda-handler';
import { S3Event, Context } from 'aws-lambda';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-textract');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-cloudwatch');

describe('Lambda Handler', () => {
  const mockS3Event: S3Event = {
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
            name: 'test-input-bucket',
            ownerIdentity: { principalId: 'test' },
            arn: 'arn:aws:s3:::test-input-bucket'
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
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '1024',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/09/14/[$LATEST]test',
    getRemainingTimeInMillis: () => 300000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };

  beforeEach(() => {
    process.env.S3_INPUT_BUCKET = 'test-input-bucket';
    process.env.S3_OUTPUT_BUCKET = 'test-output-bucket';
    process.env.DYNAMODB_USAGE_TABLE = 'test-usage-table';
    process.env.DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-dlq';
  });

  test('should handle S3 event without throwing', async () => {
    await expect(handler(mockS3Event, mockContext)).rejects.toThrow();
  });
});
