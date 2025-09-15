import { LambdaOcrProcessor } from './src/lambda-ocr-processor';
import { Logger } from './src/logger';

async function testShapeDetection(): Promise<void> {
  const logger = new Logger('test');
  const processor = new LambdaOcrProcessor(logger);
  
  // テスト用のS3設定
  const inputBucket = process.env.TEST_BUCKET || 'your-test-bucket';
  const inputKey = 'test-drawing.pdf';
  
  try {
    console.log('Testing shape detection with TakionOCR v3.0...');
    console.log(`Bucket: ${inputBucket}, Key: ${inputKey}`);
    
    const result = await processor.processS3File(inputBucket, inputKey);
    
    console.log('Processing completed:');
    console.log(`- Pages: ${result.pageCount}`);
    console.log(`- Processing time: ${result.processingTimeMs}ms`);
    
    // 図形検出結果を表示
    result.pages.forEach((page, index) => {
      console.log(`\nPage ${index + 1}:`);
      if (page.shapes) {
        console.log(`  - Shape detection enabled: ${page.shapes.enabled}`);
        if (page.shapes.enabled) {
          console.log(`  - Dominant shape: ${page.shapes.dominant_shape}`);
          console.log(`  - Shape count: ${page.shapes.shape_count}`);
          console.log(`  - Detected shapes:`, page.shapes.shapes.map(s => `${s.shape} (${s.confidence.toFixed(2)})`));
        }
      } else {
        console.log('  - Shape detection: not performed');
      }
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  testShapeDetection();
}
