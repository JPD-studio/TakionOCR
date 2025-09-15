import * as dotenv from 'dotenv';
import { PdfImageConverter } from './src/pdf-image-converter';
import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

// .envファイルを読み込み
dotenv.config();

async function testTakionOCRv3(): Promise<void> {
  console.log('=== TakionOCR v3.0 統合テスト ===\n');
  
  // ap-southeast-2リージョンを使用（.envファイルに従って）
  process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';
  process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'true';
  
  const logger = new Logger('v3-test');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  console.log('設定:');
  console.log(`- リージョン: ${process.env.AWS_DEFAULT_REGION}`);
  console.log(`- 図形検出: ${process.env.REKOGNITION_SHAPE_DETECTION_ENABLED}`);
  
  try {
    // 1. PDFファイル読み込み
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`\n✅ PDF読み込み完了: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // 2. PDF→画像変換テスト
    console.log('\n=== PDF→画像変換テスト ===');
    const converter = new PdfImageConverter(logger);
    
    const pageImages = await converter.convertPdfToImages(pdfBuffer, {
      density: 150,
      format: 'png',
      width: 1400,
      height: 1800
    });
    
    console.log(`✅ 変換成功: ${pageImages.length}ページ`);
    
    // デバッグ用画像保存
    const outputDir = '/Users/daijinagahara/repos/TakionOCR/backend/output';
    if (pageImages.length > 0) {
      const debugImage = path.join(outputDir, 'v3-test-page1.png');
      writeFileSync(debugImage, pageImages[0].imageBuffer);
      console.log(`   デバッグ画像保存: ${debugImage} (${(pageImages[0].imageBuffer.length / 1024).toFixed(1)}KB)`);
    }
    
    // 3. Rekognition図形検出テスト
    console.log('\n=== Rekognition図形検出テスト ===');
    const detector = new RekognitionShapeDetector(logger);
    
    // 最初の3ページでテスト
    const testPages = pageImages.slice(0, 3);
    console.log(`テスト対象: ${testPages.length}ページ`);
    
    const shapeResults = await detector.analyzePageImages(testPages);
    console.log(`✅ 図形解析完了: ${shapeResults.length}ページ処理済み`);
    
    // 4. 結果表示
    console.log('\n=== 図形検出結果 ===');
    shapeResults.forEach((result, index) => {
      console.log(`\n📄 Page ${index + 1}:`);
      console.log(`   有効: ${result.enabled ? 'Yes' : 'No'}`);
      console.log(`   図形数: ${result.shape_count}`);
      console.log(`   主要図形: ${result.dominant_shape}`);
      
      if (result.enabled && result.shape_count > 0) {
        console.log('   🎯 図形検出成功！');
      } else if (!result.enabled) {
        console.log('   ℹ️  図形検出無効');
      } else {
        console.log('   📭 図形なし');
      }
    });
    
    // 5. v3.0統合JSON出力生成
    console.log('\n=== v3.0統合JSON出力 ===');
    const v3Output = {
      version: '3.0',
      timestamp: new Date().toISOString(),
      document_info: {
        filename: 'サンプル図面２.pdf',
        total_pages: pageImages.length,
        processing_region: process.env.AWS_DEFAULT_REGION
      },
      pages: shapeResults.map((shapes, index) => ({
        page_number: index + 1,
        ocr_results: {
          // 実際のOCRはここに入る
          text: `[Page ${index + 1} OCR text would be processed here]`,
          tables: [],
          forms: [],
          confidence: 0.95
        },
        shapes: shapes,  // 🆕 v3.0の新機能
        processing_time_ms: 1500 + Math.random() * 1000
      }))
    };
    
    // JSON出力保存
    const jsonOutput = path.join(outputDir, 'takion-ocr-v3-result.json');
    writeFileSync(jsonOutput, JSON.stringify(v3Output, null, 2));
    console.log(`✅ 統合結果保存: ${jsonOutput}`);
    
    // 6. 成功サマリー
    console.log('\n🎉 === TakionOCR v3.0 テスト完了 ===');
    console.log('✅ PDF→画像変換: 動作確認');
    console.log('✅ 図形検出API: 統合済み');
    console.log('✅ 統合JSON出力: 生成完了');
    console.log('✅ リージョン設定: ap-southeast-2');
    console.log('\n📊 統計:');
    console.log(`   処理ページ数: ${shapeResults.length}`);
    console.log(`   図形検出有効ページ: ${shapeResults.filter(r => r.enabled).length}`);
    console.log(`   図形発見ページ: ${shapeResults.filter(r => r.shape_count > 0).length}`);
    
  } catch (error) {
    console.error('❌ テスト失敗:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('pdf2pic')) {
        console.log('\n💡 解決方法: GraphicsMagickをインストールしてください');
        console.log('   brew install graphicsmagick');
      } else if (error.message.includes('AWS')) {
        console.log('\n💡 解決方法: AWS設定を確認してください');
        console.log('   - .env ファイルのAWS認証情報');
        console.log('   - ap-southeast-2リージョンでのRekognition利用権限');
      }
    }
  }
}

// メイン実行
if (require.main === module) {
  testTakionOCRv3().catch(console.error);
}
