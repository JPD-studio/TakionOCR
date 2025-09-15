import { PdfImageConverter } from './src/pdf-image-converter';
import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';

async function testRealRekognitionWithPdf(): Promise<void> {
  console.log('=== Real AWS Rekognition Test with PDF ===\n');
  
  const logger = new Logger('rekognition-real-test');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  try {
    console.log('1. Loading PDF...');
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`✅ PDF loaded: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    console.log('\n2. Converting PDF to images...');
    const converter = new PdfImageConverter(logger);
    
    // 最初の1ページだけテスト
    const pageImages = await converter.convertPdfToImages(pdfBuffer, {
      density: 150,
      format: 'png',
      width: 1024,
      height: 1024
    });
    
    console.log(`✅ Converted ${pageImages.length} pages to images`);
    
    // 最初のページの画像を保存（デバッグ用）
    if (pageImages.length > 0) {
      const firstPage = pageImages[0];
      const debugImagePath = '/Users/daijinagahara/repos/TakionOCR/backend/output/debug-page-1.png';
      writeFileSync(debugImagePath, firstPage.imageBuffer);
      console.log(`✅ Saved debug image: ${debugImagePath} (${(firstPage.imageBuffer.length / 1024).toFixed(1)}KB)`);
    }
    
    console.log('\n3. Testing Rekognition with real PDF images...');
    process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'true';
    process.env.AWS_DEFAULT_REGION = 'ap-northeast-1';
    
    const detector = new RekognitionShapeDetector(logger);
    
    // 1ページだけでテスト
    const testPages = pageImages.slice(0, 1);
    const results = await detector.analyzePageImages(testPages);
    
    console.log('\n=== Rekognition Results ===');
    results.forEach((result, index) => {
      console.log(`\nPage ${index + 1}:`);
      console.log(`  Enabled: ${result.enabled}`);
      console.log(`  Shape count: ${result.shape_count}`);
      console.log(`  Dominant shape: ${result.dominant_shape}`);
      
      if (result.shapes.length > 0) {
        console.log(`  Detected shapes:`);
        result.shapes.forEach(shape => {
          const confidence = (shape.confidence * 100).toFixed(1);
          console.log(`    - ${shape.shape}: ${confidence}% (${shape.detected_labels.join(', ')})`);
        });
      }
    });
    
    // 結果を保存
    const outputPath = '/Users/daijinagahara/repos/TakionOCR/backend/output/rekognition-real-test-result.json';
    const testResult = {
      timestamp: new Date().toISOString(),
      test_type: 'Real Rekognition API Test',
      pdf_file: pdfPath,
      pdf_size: pdfBuffer.length,
      pages_converted: pageImages.length,
      pages_analyzed: results.length,
      results: results
    };
    
    writeFileSync(outputPath, JSON.stringify(testResult, null, 2));
    console.log(`\n✅ Results saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    if ((error as Error).message.includes('InvalidImageFormatException')) {
      console.log('\n🔍 Troubleshooting image format:');
      console.log('- Check GraphicsMagick/ImageMagick installation');
      console.log('- Verify PNG conversion quality');
      console.log('- Try different density/size settings');
    }
  }
}

if (require.main === module) {
  testRealRekognitionWithPdf();
}
