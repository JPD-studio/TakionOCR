import * as dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { OcrProcessor } from './ocr-processor';
import { Logger } from './logger';

dotenv.config();

async function runLocal(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('file', {
      alias: 'f',
      type: 'string',
      description: 'Path to the PDF file to process',
      demandOption: true
    })
    .option('engine', {
      alias: 'e',
      type: 'string',
      description: 'OCR engine to use (textract or textract-analyze)',
      choices: ['textract', 'textract-analyze'],
      default: 'textract'
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory',
      default: '../output'
    })
    .help()
    .argv;

  const filePath = argv.file;
  const engine = argv.engine;
  const outputDir = argv.output;

  const logger = new Logger('local-' + Date.now());

  try {
    const processor = new OcrProcessor(logger);
    
    // Generate proper output file path
    const inputFileName = filePath.split('/').pop()?.replace('.pdf', '') || 'output';
    const outputPath = `${outputDir}/${inputFileName}-result.json`;
    
    await processor.processLocalFile(filePath, outputPath, engine);
    logger.info('Local processing completed', { filePath, outputPath });
    console.log('Local execution completed successfully');
  } catch (error) {
    console.error('Local execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runLocal();
}
