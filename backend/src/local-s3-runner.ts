import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { LambdaOcrProcessor } from './lambda-ocr-processor';
import { S3Client, PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Logger } from './logger';

interface LocalTestOptions {
  filePath: string;
  outputPath: string;
  useLocalStack?: boolean;
  bucketName?: string;
  region?: string;
}

export class LocalS3TestRunner {
  private s3Client: S3Client;
  private logger: Logger;
  
  constructor(private options: LocalTestOptions) {
    const endpoint = options.useLocalStack ? 'http://localhost:4566' : undefined;
    const region = options.region || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    
    const s3Config: any = { region };
    if (endpoint) {
      s3Config.endpoint = endpoint;
      s3Config.forcePathStyle = true;
      s3Config.credentials = {
        accessKeyId: 'test',
        secretAccessKey: 'test'
      };
    }
    
    this.s3Client = new S3Client(s3Config);
    this.logger = new Logger('local-test');
  }

  async run(): Promise<void> {
    try {
      const { filePath, outputPath, bucketName = 'test-bucket' } = this.options;
      
      this.logger.info('Starting local S3-based OCR test', { filePath, outputPath, bucketName });
      
      // Create bucket if it doesn't exist
      try {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        this.logger.info('Created test bucket', { bucketName });
      } catch (error) {
        const err = error as any;
        if (err.Code === 'BucketAlreadyExists' || err.Code === 'BucketAlreadyOwnedByYou') {
          this.logger.info('Bucket already exists', { bucketName });
        } else {
          this.logger.warn('Bucket creation failed, proceeding anyway', { 
            bucketName, 
            error: err.message 
          });
        }
      }
      
      // Upload file to S3
      const fileBuffer = readFileSync(filePath);
      const s3Key = `input/${filePath.split('/').pop()}`;
      
      await this.s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: 'application/pdf'
      }));
      
      this.logger.info('File uploaded to S3', { bucketName, s3Key });
      
      // Process using Lambda OCR processor
      const processor = new LambdaOcrProcessor(this.logger);
      const result = await processor.processS3File(
        bucketName, 
        s3Key, 
        bucketName, 
        `output/${s3Key.replace(/\.[^/.]+$/, '')}-result.json`
      );
      
      // Save result locally
      const outputDir = dirname(outputPath);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(outputPath, JSON.stringify(result, null, 2));
      
      this.logger.info('Local S3-based OCR test completed', { 
        inputFile: filePath,
        outputFile: outputPath,
        pageCount: result.pageCount,
        formsCount: result.forms?.length || 0,
        tablesCount: result.tables?.length || 0
      });
      
      // Print summary
      console.log('\n=== OCR Test Results ===');
      console.log(`Input: ${filePath}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Pages processed: ${result.pageCount}`);
      console.log(`Forms found: ${result.forms?.length || 0}`);
      console.log(`Tables found: ${result.tables?.length || 0}`);
      
      // Show page-by-page breakdown
      console.log('\n=== Page-by-Page Breakdown ===');
      result.pages.forEach((page, index) => {
        const pageFormsCount = page.forms?.length || 0;
        const pageTablesCount = page.tables?.length || 0;
        console.log(`Page ${index + 1}: ${pageFormsCount} forms, ${pageTablesCount} tables`);
      });
      
      if (result.tables && result.tables.length > 0) {
        console.log('\n=== Table Preview (All Pages) ===');
        result.tables.slice(0, 2).forEach((table, idx) => {
          console.log(`Table ${idx + 1}:`);
          if (table.rows && table.rows.length > 0) {
            table.rows.slice(0, 3).forEach((row, rowIdx) => {
              console.log(`  Row ${rowIdx + 1}: [${row.join(' | ')}]`);
            });
            if (table.rows.length > 3) {
              console.log(`  ... and ${table.rows.length - 3} more rows`);
            }
          } else {
            console.log(`  ${table.cells.length} cells (no rows structure)`);
          }
        });
      }

      // Show sample page tables
      const firstPageWithTables = result.pages.find(p => p.tables && p.tables.length > 0);
      if (firstPageWithTables) {
        console.log(`\n=== Page ${firstPageWithTables.pageNumber} Tables ===`);
        firstPageWithTables.tables!.slice(0, 1).forEach((table, idx) => {
          console.log(`Page ${firstPageWithTables.pageNumber} - Table ${idx + 1}:`);
          if (table.rows && table.rows.length > 0) {
            table.rows.slice(0, 3).forEach((row, rowIdx) => {
              console.log(`  Row ${rowIdx + 1}: [${row.join(' | ')}]`);
            });
          }
        });
      }
      
    } catch (error) {
      this.logger.error('Local S3 test failed', { error: (error as Error).message });
      throw error;
    }
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args.find(arg => arg.startsWith('--file='))?.split('=')[1];
  const outputPath = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const useLocalStack = args.includes('--localstack');
  const bucketName = args.find(arg => arg.startsWith('--bucket='))?.split('=')[1];
  
  if (!filePath || !outputPath) {
    console.error('Usage: ts-node local-s3-runner.ts --file=<path> --output=<path> [--localstack] [--bucket=<name>]');
    process.exit(1);
  }
  
  const options: LocalTestOptions = {
    filePath,
    outputPath,
    useLocalStack
  };
  
  if (bucketName) {
    options.bucketName = bucketName;
  }
  
  const runner = new LocalS3TestRunner(options);
  
  await runner.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Local S3 test failed:', error);
    process.exit(1);
  });
}
