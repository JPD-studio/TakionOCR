import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

async function diagnosePngFormat(): Promise<void> {
  console.log('=== Rekognition PNG Format Diagnosis ===\n');
  
  process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';
  
  const client = new RekognitionClient({
    region: process.env.AWS_DEFAULT_REGION
  });
  
  try {
    // 生成されたPNG画像をテスト
    const pngPath = '/Users/daijinagahara/repos/TakionOCR/backend/output/v3-test-page1.png';
    const pngBuffer = readFileSync(pngPath);
    
    console.log('PNG Image Analysis:');
    console.log(`- File size: ${(pngBuffer.length / 1024).toFixed(1)}KB`);
    console.log(`- First 16 bytes: ${Array.from(pngBuffer.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // PNG署名確認
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const isValidPng = pngSignature.every((byte, index) => pngBuffer[index] === byte);
    console.log(`- Valid PNG signature: ${isValidPng ? 'Yes' : 'No'}`);
    
    // Rekognitionでテスト（限界値チェック）
    console.log('\nTesting with Rekognition:');
    
    // 元のサイズでテスト
    try {
      const result1 = await client.send(new DetectLabelsCommand({
        Image: { Bytes: pngBuffer },
        MaxLabels: 5,
        MinConfidence: 50
      }));
      
      console.log(`✅ Original size OK: ${result1.Labels?.length || 0} labels`);
    } catch (error) {
      console.log(`❌ Original size failed: ${(error as Error).message}`);
      
      // サイズ制限チェック
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (pngBuffer.length > maxSize) {
        console.log(`   Issue: File too large (${(pngBuffer.length / 1024 / 1024).toFixed(1)}MB > 5MB limit)`);
      }
      
      // 画像サイズ制限チェック（推定）
      console.log('   Checking if dimensions are within limits...');
      
      // 小さいテストサンプルで確認
      const testPng = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x70, 0xE2, 0x95, 0x25, 0x00, 0x00, 0x00,
        0x15, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0x0F, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      
      try {
        await client.send(new DetectLabelsCommand({
          Image: { Bytes: testPng },
          MaxLabels: 5,
          MinConfidence: 50
        }));
        
        console.log('✅ Simple PNG test OK - Issue is with image size/dimensions');
        
      } catch (testError) {
        console.log('❌ Simple PNG test failed:', (testError as Error).message);
      }
    }
    
    // 推奨設定提案
    console.log('\n💡 Recommendations:');
    if (pngBuffer.length > 3 * 1024 * 1024) {
      console.log('- Reduce image density (current: 150 -> try: 100)');
    }
    if (isValidPng) {
      console.log('- PNG format is valid, try JPEG format instead');
    }
    console.log('- Try smaller dimensions (current: 1400x1800 -> try: 1000x1200)');
    
  } catch (error) {
    console.error('❌ Diagnosis failed:', error);
  }
}

if (require.main === module) {
  diagnosePngFormat().catch(console.error);
}
