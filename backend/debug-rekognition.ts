import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { Logger } from './src/logger';

async function debugRekognitionError(): Promise<void> {
  console.log('=== Rekognition Error Debugging ===\n');
  
  const logger = new Logger('rekognition-debug');
  
  // 1. クライアント設定確認
  console.log('1. Checking Rekognition client configuration...');
  const rekognitionClient = new RekognitionClient({
    region: process.env.AWS_DEFAULT_REGION || 'ap-northeast-1'
  });
  
  console.log('✅ RekognitionClient created');
  console.log('   Region:', process.env.AWS_DEFAULT_REGION || 'ap-northeast-1 (default)');
  
  // 2. 簡単な画像でテスト（小さなダミー画像）
  console.log('\n2. Testing with minimal valid image data...');
  
  try {
    // 最小限の有効なJPEG画像データ（1x1ピクセル）
    const minimalJpeg = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
      0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
      0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
      0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
      0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xFF, 0xC4,
      0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C,
      0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0x80, 0xFF, 0xD9
    ]);
    
    const command = new DetectLabelsCommand({
      Image: {
        Bytes: minimalJpeg
      },
      MaxLabels: 10,
      MinConfidence: 70
    });
    
    console.log('   Sending DetectLabels request...');
    const result = await rekognitionClient.send(command);
    console.log('✅ SUCCESS: Rekognition API is working!');
    console.log(`   Detected ${result.Labels?.length || 0} labels`);
    
    if (result.Labels && result.Labels.length > 0) {
      result.Labels.forEach(label => {
        console.log(`     - ${label.Name}: ${(label.Confidence || 0).toFixed(1)}%`);
      });
    }
    
  } catch (error) {
    const err = error as Error;
    console.log('❌ FAILED: Rekognition API error');
    console.log('   Error name:', err.name);
    console.log('   Error message:', err.message);
    
    // 具体的なエラータイプを判定
    if (err.message.includes('credentials')) {
      console.log('\n🔍 Diagnosis: CREDENTIALS ISSUE');
      console.log('   - AWS credentials may be invalid or expired');
      console.log('   - Check: aws configure list');
      console.log('   - Check: aws sts get-caller-identity');
    } else if (err.message.includes('region')) {
      console.log('\n🔍 Diagnosis: REGION ISSUE');
      console.log('   - Rekognition may not be available in this region');
      console.log('   - Try: us-east-1, us-west-2, eu-west-1');
    } else if (err.message.includes('parameters')) {
      console.log('\n🔍 Diagnosis: PARAMETER ISSUE');
      console.log('   - Image data may be invalid');
      console.log('   - Image may be too small or corrupted');
    } else if (err.message.includes('AccessDenied') || err.message.includes('UnauthorizedOperation')) {
      console.log('\n🔍 Diagnosis: PERMISSION ISSUE');
      console.log('   - AWS user lacks Rekognition permissions');
      console.log('   - Required: rekognition:DetectLabels');
    } else {
      console.log('\n🔍 Diagnosis: UNKNOWN ISSUE');
      console.log('   - May be service availability or other AWS issue');
    }
  }
  
  // 3. AWS認証情報確認
  console.log('\n3. Checking AWS identity...');
  try {
    const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
    const stsClient = new STSClient({
      region: process.env.AWS_DEFAULT_REGION || 'ap-northeast-1'
    });
    
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    console.log('✅ AWS identity confirmed:');
    console.log(`   Account: ${identity.Account}`);
    console.log(`   User ARN: ${identity.Arn}`);
    console.log(`   User ID: ${identity.UserId}`);
    
  } catch (error) {
    console.log('❌ AWS identity check failed:', (error as Error).message);
  }
}

if (require.main === module) {
  debugRekognitionError();
}
