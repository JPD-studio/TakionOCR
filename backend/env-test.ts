import * as dotenv from 'dotenv';
import { PdfImageConverter } from './src/pdf-image-converter';
import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';

// .envファイルを読み込み
dotenv.config();

async function testWithEnvSettings(): Promise<void> {
  console.log('=== TakionOCR v3.0 Test with .env Settings ===\n');
  
  const logger = new Logger('env-test');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  // .env設定を表示
  console.log('Environment Settings from .env:');
  console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`- AWS_DEFAULT_REGION: ${process.env.AWS_DEFAULT_REGION}`);
  console.log(`- S3_INPUT_BUCKET: ${process.env.S3_INPUT_BUCKET}`);
  console.log(`- S3_OUTPUT_BUCKET: ${process.env.S3_OUTPUT_BUCKET}`);
  console.log(`- AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID?.substring(0, 8)}...`);
  
  try {
    // 1. AWS認証確認
    console.log('\n1. Verifying AWS credentials...');
    const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
    const stsClient = new STSClient({
      region: process.env.AWS_DEFAULT_REGION || 'ap-southeast-2'
    });
    
    try {
      const identity = await stsClient.send(new GetCallerIdentityCommand({}));
      console.log('✅ AWS credentials valid:');
      console.log(`   Account: ${identity.Account}`);
      console.log(`   Region: ${process.env.AWS_DEFAULT_REGION}`);
    } catch (error) {
      console.log('❌ AWS credentials invalid:', (error as Error).message);
      return;
    }
    
    // 2. Rekognition可用性チェック（指定リージョン）
    console.log('\n2. Testing Rekognition availability...');
    const { RekognitionClient, DetectLabelsCommand } = await import('@aws-sdk/client-rekognition');
    const rekognitionClient = new RekognitionClient({
      region: process.env.AWS_DEFAULT_REGION || 'ap-southeast-2'
    });
    
    // 最小限のテスト画像で確認
    try {
      // 有効なPNG画像データ（1x1ピクセル白色）
      const testPng = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0x0F, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      
      const testCommand = new DetectLabelsCommand({
        Image: {
          Bytes: testPng
        },
        MaxLabels: 5,
        MinConfidence: 70
      });
      
      const testResult = await rekognitionClient.send(testCommand);
      console.log('✅ Rekognition available in', process.env.AWS_DEFAULT_REGION);
      console.log(`   Test result: ${testResult.Labels?.length || 0} labels detected`);
      
    } catch (error) {
      const err = error as Error;
      console.log('⚠️  Rekognition test result:', err.message);
      
      if (err.message.includes('InvalidImageFormatException')) {
        console.log('   Issue: Image format problem (may still work with PDF-converted images)');
      } else if (err.message.includes('AccessDenied')) {
        console.log('   Issue: Insufficient permissions for Rekognition');
      } else {
        console.log('   Issue: Other Rekognition problem');
      }
    }
    
    // 3. PDF→画像変換テスト
    console.log('\n3. Testing PDF to image conversion...');
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`✅ PDF loaded: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    const converter = new PdfImageConverter(logger);
    
    // 最初の1ページだけでテスト
    try {
      const pageImages = await converter.convertPdfToImages(pdfBuffer.slice(0, Math.min(pdfBuffer.length, 1024 * 1024)), {
        density: 100,  // 低解像度でテスト
        format: 'jpg', // JPEGでテスト
        width: 800,
        height: 600
      });
      
      console.log(`✅ PDF conversion successful: ${pageImages.length} pages`);
      
      // デバッグ用に保存
      if (pageImages.length > 0) {
        const debugPath = '/Users/daijinagahara/repos/TakionOCR/backend/output/env-test-page1.jpg';
        writeFileSync(debugPath, pageImages[0].imageBuffer);
        console.log(`   Debug image saved: ${debugPath} (${(pageImages[0].imageBuffer.length / 1024).toFixed(1)}KB)`);
      }
      
    } catch (error) {
      console.log('❌ PDF conversion failed:', (error as Error).message);
    }
    
    // 4. 実際の図形検出テスト
    console.log('\n4. Testing shape detection with .env settings...');
    process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'true';
    
    const detector = new RekognitionShapeDetector(logger);
    
    try {
      // 小さなテスト用PDFで試す
      const smallTestResult = await detector.analyzeDocumentShapes(pdfBuffer.slice(0, 500000)); // 500KB制限
      
      console.log('✅ Shape detection test completed');
      console.log(`   Results: ${smallTestResult.length} pages analyzed`);
      
      smallTestResult.forEach((page, index) => {
        console.log(`   Page ${index + 1}: ${page.enabled ? 'Enabled' : 'Disabled'}, ${page.shape_count} shapes, dominant: ${page.dominant_shape}`);
      });
      
    } catch (error) {
      console.log('⚠️  Shape detection test result:', (error as Error).message);
      console.log('   This is expected if there are still image format or service issues');
    }
    
    // 5. Parameter Store接続テスト
    console.log('\n5. Testing Parameter Store with .env region...');
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
    const ssmClient = new SSMClient({
      region: process.env.AWS_DEFAULT_REGION || 'ap-southeast-2'
    });
    
    try {
      const paramResult = await ssmClient.send(new GetParameterCommand({
        Name: '/config/pdf-ocr/rekognition-shape-detection-enabled'
      }));
      
      console.log('✅ Parameter Store accessible');
      console.log(`   rekognition-shape-detection-enabled: ${paramResult.Parameter?.Value}`);
      
    } catch (error) {
      console.log('❌ Parameter Store access failed:', (error as Error).message);
      console.log('   Parameters may need to be created in the correct region');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log('\n=== Test Summary ===');
  console.log('🎯 Using .env configuration for all AWS services');
  console.log(`📍 Region: ${process.env.AWS_DEFAULT_REGION}`);
  console.log('✅ Environment setup completed');
}

if (require.main === module) {
  testWithEnvSettings();
}
