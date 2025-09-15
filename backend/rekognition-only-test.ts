import * as dotenv from 'dotenv';
import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { Logger } from './src/logger';
import { readFileSync } from 'fs';

// .envファイルを読み込み
dotenv.config();

async function testRekognitionOnly(): Promise<void> {
  console.log('=== Rekognition Shape Detection Test ===\n');
  
  const logger = new Logger('rekognition-test');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  console.log('Environment Settings:');
  console.log(`- AWS_DEFAULT_REGION: ${process.env.AWS_DEFAULT_REGION}`);
  console.log(`- Using Region: ap-southeast-2 (force override)`);
  
  try {
    // ap-southeast-2を強制的に設定
    process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';
    
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`✅ PDF loaded: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // Shape detection test with full PDF
    const detector = new RekognitionShapeDetector(logger);
    
    console.log('\nTesting shape detection with full PDF...');
    const shapeResults = await detector.analyzeDocumentShapes(pdfBuffer);
    
    console.log(`✅ Shape detection completed: ${shapeResults.length} pages`);
    
    shapeResults.forEach((page, index) => {
      console.log(`Page ${index + 1}:`);
      console.log(`  - Enabled: ${page.enabled}`);
      console.log(`  - Shape count: ${page.shape_count}`);
      console.log(`  - Dominant shape: ${page.dominant_shape}`);
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (require.main === module) {
  testRekognitionOnly();
}
