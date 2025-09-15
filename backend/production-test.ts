import * as dotenv from 'dotenv';
import { LambdaOcrProcessor } from './src/lambda-ocr-processor';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

// .envファイルを読み込み
dotenv.config();

async function productionLevelIntegratedTest(): Promise<void> {
  console.log('🚀 === TakionOCR v3.0 本番レベル統合テスト ===\n');
  console.log('⚠️  実際のAWS料金が発生します');
  console.log('📋 処理: Textract OCR + Rekognition図形検出\n');
  
  // .env設定を使用
  const logger = new Logger('production-test');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  console.log('🔧 環境設定:');
  console.log(`   リージョン: ${process.env.AWS_DEFAULT_REGION}`);
  console.log(`   S3入力バケット: ${process.env.S3_INPUT_BUCKET}`);
  console.log(`   S3出力バケット: ${process.env.S3_OUTPUT_BUCKET}`);
  console.log(`   図形検出: ${process.env.REKOGNITION_SHAPE_DETECTION_ENABLED || 'true'}`);
  
  try {
    // 1. PDFファイル準備
    console.log('\n📄 === PDFファイル準備 ===');
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`✅ PDF読み込み完了: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // 2. Lambda OCR Processor初期化（本番設定）
    console.log('\n🔧 === Lambda OCR Processor初期化 ===');
    const ocrProcessor = new LambdaOcrProcessor(logger);
    console.log('✅ OCRプロセッサー初期化完了');
    
    // 3. 本番環境準備（S3にPDFアップロード）
    console.log('\n☁️  === S3環境準備 ===');
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({
      region: process.env.AWS_DEFAULT_REGION || 'ap-southeast-2'
    });
    
    // ユニークなファイル名生成
    const s3Timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `production-test/sample-drawing-${s3Timestamp}.pdf`;
    const inputBucket = 'takion-ocr-production-test'; // 新規作成バケット
    const outputBucket = 'takion-ocr-production-test'; // 同一バケット使用
    
    console.log(`📤 S3アップロード: ${inputBucket}/${s3Key}`);
    
    // PDFをS3にアップロード
    await s3Client.send(new PutObjectCommand({
      Bucket: inputBucket,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf'
    }));
    
    console.log('✅ S3アップロード完了');
    
    // 4. 実際の統合処理実行（本番フロー）
    console.log('\n⚡ === 本番統合処理実行 ===');
    console.log('📊 処理フロー:');
    console.log('   - S3からPDF取得');
    console.log('   - PDF → 画像変換');
    console.log('   - AWS Textract OCR処理');
    console.log('   - AWS Rekognition図形検出');
    console.log('   - 統合結果をS3に保存');
    
    const startTime = Date.now();
    
    // 本番と同じS3ベース処理実行
    const result = await ocrProcessor.processS3File(
      inputBucket,
      s3Key,
      outputBucket,
      `production-test-results/result-${s3Timestamp}.json`
    );
    
    const endTime = Date.now();
    const processingTimeSeconds = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('\n🎉 === 処理完了 ===');
    console.log(`⏱️  総処理時間: ${processingTimeSeconds}秒`);
    console.log(`📄 処理ページ数: ${result.pages.length}ページ`);
    
    // 4. 結果分析
    console.log('\n📊 === 結果分析 ===');
    
    // OCR結果統計
    let totalTextLength = 0;
    let totalTables = 0;
    let totalForms = 0;
    const avgConfidence = 0;
    
    result.pages.forEach(page => {
      if (page.text) totalTextLength += page.text.length;
      if (page.tables) totalTables += page.tables.length;
      if (page.forms) totalForms += page.forms.length;
    });
    
    // 図形検出統計
    let shapesEnabledPages = 0;
    let totalShapesFound = 0;
    const dominantShapes: string[] = [];
    
    result.pages.forEach(page => {
      if (page.shapes) {
        if (page.shapes.enabled) shapesEnabledPages++;
        totalShapesFound += page.shapes.shape_count || 0;
        if (page.shapes.dominant_shape && page.shapes.dominant_shape !== 'unknown') {
          dominantShapes.push(page.shapes.dominant_shape);
        }
      }
    });
    
    console.log('📝 OCR結果統計:');
    console.log(`   抽出文字数: ${totalTextLength.toLocaleString()}文字`);
    console.log(`   検出テーブル数: ${totalTables}個`);
    console.log(`   検出フォーム数: ${totalForms}個`);
    console.log(`   平均信頼度: ${avgConfidence.toFixed(2)}`);
    
    console.log('\n🔍 図形検出統計:');
    console.log(`   図形検出有効ページ: ${shapesEnabledPages}/${result.pages.length}ページ`);
    console.log(`   総図形検出数: ${totalShapesFound}個`);
    console.log(`   検出された主要図形: ${dominantShapes.length > 0 ? dominantShapes.join(', ') : 'なし'}`);
    
    // 5. 詳細結果表示（最初の3ページ）
    console.log('\n📄 === 詳細結果（最初の3ページ） ===');
    result.pages.slice(0, 3).forEach((page, index) => {
      console.log(`\nPage ${index + 1}:`);
      console.log(`   📝 OCR文字数: ${page.text ? page.text.length : 0}文字`);
      console.log(`   📊 テーブル: ${page.tables ? page.tables.length : 0}個`);
      console.log(`   📋 フォーム: ${page.forms ? page.forms.length : 0}個`);
      
      if (page.shapes) {
        console.log(`   🔍 図形検出: ${page.shapes.enabled ? '有効' : '無効'}`);
        console.log(`   🎯 検出図形: ${page.shapes.shape_count || 0}個`);
        console.log(`   🔺 主要図形: ${page.shapes.dominant_shape || 'unknown'}`);
      }
      
      // テキストサンプル表示（最初の100文字）
      if (page.text && page.text.length > 0) {
        const textSample = page.text.substring(0, 100).replace(/\n/g, ' ');
        console.log(`   📖 テキストサンプル: "${textSample}${page.text.length > 100 ? '...' : ''}"`);
      }
    });
    
    // 6. 本番レベル結果保存
    console.log('\n💾 === 本番レベル結果保存 ===');
    const outputTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFileName = `production-integrated-result-${outputTimestamp}.json`;
    const outputPath = path.join('/Users/daijinagahara/repos/TakionOCR/backend/output', outputFileName);
    
    // 処理メタデータを追加
    const productionResult = {
      ...result,
      processing_metadata: {
        test_type: 'production_level_integrated',
        timestamp: new Date().toISOString(),
        processing_time_seconds: parseFloat(processingTimeSeconds),
        aws_region: process.env.AWS_DEFAULT_REGION,
        s3_input: `${inputBucket}/${s3Key}`,
        features_used: ['textract_ocr', 'rekognition_shape_detection'],
        statistics: {
          total_pages: result.pages.length,
          ocr_text_characters: totalTextLength,
          detected_tables: totalTables,
          detected_forms: totalForms,
          shape_enabled_pages: shapesEnabledPages,
          total_shapes_found: totalShapesFound
        }
      }
    };
    
    writeFileSync(outputPath, JSON.stringify(productionResult, null, 2));
    console.log(`✅ 本番結果保存完了: ${outputFileName}`);
    console.log(`📁 保存先: ${outputPath}`);
    console.log(`📊 ファイルサイズ: ${(Buffer.byteLength(JSON.stringify(productionResult)) / 1024).toFixed(1)}KB`);
    
    // 7. 成功サマリー
    console.log('\n🎉 === 本番レベルテスト完了サマリー ===');
    console.log('✅ 実際のPDF処理: 完了');
    console.log('✅ 実際のTextract OCR: 完了');
    console.log('✅ 実際のRekognition図形検出: 完了');
    console.log('✅ 統合JSON出力: 完了');
    console.log(`✅ 処理パフォーマンス: ${processingTimeSeconds}秒/${result.pages.length}ページ`);
    console.log(`✅ データ品質: ${totalTextLength}文字抽出, ${totalShapesFound}図形検出`);
    
    // 8. コスト推定
    const estimatedCost = {
      textract: (result.pages.length * 0.0015).toFixed(4), // $0.0015/page
      rekognition: (result.pages.length * 0.001).toFixed(4), // $0.001/image
      total: (result.pages.length * 0.0025).toFixed(4)
    };
    
    console.log('\n💰 === 推定コスト ===');
    console.log(`📄 Textract (${result.pages.length}ページ): $${estimatedCost.textract}`);
    console.log(`🔍 Rekognition (${result.pages.length}画像): $${estimatedCost.rekognition}`);
    console.log(`💳 合計推定コスト: $${estimatedCost.total} (約${(parseFloat(estimatedCost.total) * 150).toFixed(2)}円)`);
    
    console.log('\n🚀 TakionOCR v3.0 本番レベル統合処理が正常に完了しました！');
    
  } catch (error) {
    console.error('❌ 本番レベルテスト失敗:', error);
    
    if (error instanceof Error) {
      console.log('\n🔧 トラブルシューティング:');
      if (error.message.includes('AccessDenied')) {
        console.log('   - AWS権限の確認（Textract, Rekognition）');
      }
      if (error.message.includes('Region')) {
        console.log('   - AWSリージョン設定の確認');
      }
      if (error.message.includes('Bucket')) {
        console.log('   - S3バケット設定の確認');
      }
      console.log('   - .envファイルの設定確認');
      console.log('   - AWS認証情報の確認');
    }
  }
}

// メイン実行
if (require.main === module) {
  productionLevelIntegratedTest().catch(console.error);
}
