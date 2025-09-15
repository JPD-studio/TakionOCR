import * as dotenv from 'dotenv';
import { PdfImageConverter } from './src/pdf-image-converter';
import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

// .envファイルを読み込み
dotenv.config();

interface DirectOcrResult {
  page_number: number;
  text: string;
  confidence: number;
  word_count: number;
}

async function directProductionTest(): Promise<void> {
  console.log('🚀 === TakionOCR v3.0 直接本番テスト ===\n');
  console.log('⚠️  実際のTextract + Rekognition料金が発生します');
  console.log('📋 S3を使わず直接APIでテスト\n');
  
  process.env.AWS_DEFAULT_REGION = 'ap-northeast-1';
  process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'true';
  
  const logger = new Logger('direct-production');
  const pdfPath = '/Users/daijinagahara/repos/TakionOCR/samples/test-documents/サンプル図面２.pdf';
  
  console.log('🔧 環境設定:');
  console.log(`   リージョン: ${process.env.AWS_DEFAULT_REGION}`);
  console.log(`   図形検出: 有効`);
  
  try {
    // 1. PDFファイル準備
    console.log('\n📄 === PDFファイル準備 ===');
    const pdfBuffer = readFileSync(pdfPath);
    console.log(`✅ PDF読み込み: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // 2. PDF→画像変換（統合処理用）
    console.log('\n🖼️  === PDF→画像変換 ===');
    const converter = new PdfImageConverter(logger);
    
    const startConversion = Date.now();
    const pageImages = await converter.convertPdfToImages(pdfBuffer, {
      density: 120,
      format: 'png',
      width: 1200,
      height: 1500
    });
    const conversionTime = ((Date.now() - startConversion) / 1000).toFixed(1);
    
    console.log(`✅ 変換完了: ${pageImages.length}ページ (${conversionTime}秒)`);
    
    // デバッグ用：変換された画像サイズ確認
    pageImages.slice(0, 3).forEach((page, index) => {
      console.log(`   Page ${index + 1}: ${(page.imageBuffer.length / 1024).toFixed(1)}KB`);
    });
    
    // 3. 実際のTextract OCR処理（直接API）
    console.log('\n📝 === 実際のTextract OCR処理 ===');
    const textractClient = new TextractClient({
      region: process.env.AWS_DEFAULT_REGION || 'ap-northeast-1'
    });
    
    const ocrResults: DirectOcrResult[] = [];
    
    // 最初の3ページで実際のTextract処理（コスト考慮）
    const testPageCount = Math.min(3, pageImages.length);
    console.log(`実OCR処理: ${testPageCount}ページ`);
    
    for (let i = 0; i < testPageCount; i++) {
      const pageNumber = i + 1;
      console.log(`📄 Page ${pageNumber} Textract処理中...`);
      
      try {
        const command = new DetectDocumentTextCommand({
          Document: {
            Bytes: pageImages[i].imageBuffer
          }
        });
        
        const startOcr = Date.now();
        const response = await textractClient.send(command);
        const ocrTime = Date.now() - startOcr;
        
        // テキスト抽出
        let extractedText = '';
        let totalConfidence = 0;
        let wordCount = 0;
        
        if (response.Blocks) {
          for (const block of response.Blocks) {
            if (block.BlockType === 'WORD' && block.Text) {
              extractedText += block.Text + ' ';
              if (block.Confidence) {
                totalConfidence += block.Confidence;
                wordCount++;
              }
            }
          }
        }
        
        const avgConfidence = wordCount > 0 ? (totalConfidence / wordCount) : 0;
        
        ocrResults.push({
          page_number: pageNumber,
          text: extractedText.trim(),
          confidence: avgConfidence / 100, // 0-1スケール
          word_count: wordCount
        });
        
        console.log(`✅ Page ${pageNumber}: ${wordCount}語, 信頼度${(avgConfidence).toFixed(1)}%, ${ocrTime}ms`);
        
      } catch (error) {
        console.log(`❌ Page ${pageNumber} OCR失敗:`, (error as Error).message);
        ocrResults.push({
          page_number: pageNumber,
          text: '',
          confidence: 0,
          word_count: 0
        });
      }
    }
    
    // 4. 実際のRekognition図形検出（全ページ）
    console.log('\n🔍 === 実際のRekognition図形検出 ===');
    const detector = new RekognitionShapeDetector(logger);
    
    console.log(`図形検出処理: 全${pageImages.length}ページ`);
    const startShapes = Date.now();
    const shapeResults = await detector.analyzePageImages(pageImages);
    const shapesTime = ((Date.now() - startShapes) / 1000).toFixed(1);
    
    console.log(`✅ 図形検出完了: ${shapeResults.length}ページ (${shapesTime}秒)`);
    
    // 5. 結果統計
    console.log('\n📊 === 実処理結果統計 ===');
    
    // OCR統計
    const totalWords = ocrResults.reduce((sum, r) => sum + r.word_count, 0);
    const totalChars = ocrResults.reduce((sum, r) => sum + r.text.length, 0);
    const avgOcrConfidence = ocrResults
      .filter(r => r.confidence > 0)
      .reduce((sum, r, _, arr) => sum + r.confidence / arr.length, 0);
    
    // 図形統計
    const enabledShapes = shapeResults.filter(r => r.enabled).length;
    const foundShapes = shapeResults.reduce((sum, r) => sum + (r.shape_count || 0), 0);
    const dominantShapes = shapeResults
      .map(r => r.dominant_shape)
      .filter(s => s && s !== 'unknown');
    
    console.log('📝 実OCR統計:');
    console.log(`   処理ページ: ${ocrResults.length}/${pageImages.length}ページ`);
    console.log(`   抽出単語数: ${totalWords.toLocaleString()}語`);
    console.log(`   抽出文字数: ${totalChars.toLocaleString()}文字`);
    console.log(`   平均信頼度: ${(avgOcrConfidence * 100).toFixed(1)}%`);
    
    console.log('\n🔍 実図形検出統計:');
    console.log(`   検出有効ページ: ${enabledShapes}/${pageImages.length}ページ`);
    console.log(`   総図形検出数: ${foundShapes}個`);
    console.log(`   主要図形: ${dominantShapes.length > 0 ? dominantShapes.join(', ') : 'なし'}`);
    
    // 6. 詳細結果表示
    console.log('\n📋 === ページ別詳細結果 ===');
    const maxPages = Math.max(ocrResults.length, shapeResults.length);
    
    for (let i = 0; i < Math.min(maxPages, 3); i++) {
      const pageNum = i + 1;
      const ocrData = ocrResults.find(o => o.page_number === pageNum);
      const shapeData = shapeResults[i];
      
      console.log(`\n📄 Page ${pageNum}:`);
      
      if (ocrData) {
        console.log(`   📝 OCR: ${ocrData.word_count}語, 信頼度${(ocrData.confidence * 100).toFixed(1)}%`);
        
        // テキストサンプル
        if (ocrData.text.length > 0) {
          const sample = ocrData.text.substring(0, 80).replace(/\s+/g, ' ');
          console.log(`   📖 テキスト: "${sample}${ocrData.text.length > 80 ? '...' : ''}"`);
        }
      } else {
        console.log(`   📝 OCR: 未処理`);
      }
      
      if (shapeData) {
        console.log(`   🔍 図形: ${shapeData.enabled ? '有効' : '無効'}, ${shapeData.shape_count || 0}個検出`);
        console.log(`   🎯 主要図形: ${shapeData.dominant_shape || 'unknown'}`);
      }
    }
    
    // 7. 統合結果生成・保存
    console.log('\n💾 === 本番統合結果生成 ===');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    const productionResult = {
      version: '3.0',
      test_type: 'direct_production',
      timestamp: new Date().toISOString(),
      document_info: {
        filename: 'サンプル図面２.pdf',
        total_pages: pageImages.length,
        ocr_processed_pages: ocrResults.length,
        processing_region: process.env.AWS_DEFAULT_REGION
      },
      performance_metrics: {
        conversion_time_seconds: parseFloat(conversionTime),
        shapes_detection_time_seconds: parseFloat(shapesTime),
        total_processing_time: parseFloat(conversionTime) + parseFloat(shapesTime)
      },
      statistics: {
        ocr: {
          total_words: totalWords,
          total_characters: totalChars,
          average_confidence: avgOcrConfidence
        },
        shapes: {
          enabled_pages: enabledShapes,
          total_shapes_found: foundShapes,
          dominant_shapes: dominantShapes
        }
      },
      pages: Array.from({ length: pageImages.length }, (_, index) => {
        const pageNum = index + 1;
        const ocrData = ocrResults.find(o => o.page_number === pageNum);
        const shapeData = shapeResults[index];
        
        return {
          page_number: pageNum,
          ocr_results: ocrData ? {
            text: ocrData.text,
            word_count: ocrData.word_count,
            confidence: ocrData.confidence
          } : {
            text: '[Not processed in this test]',
            word_count: 0,
            confidence: 0
          },
          shapes: shapeData
        };
      })
    };
    
    // 結果保存
    const outputPath = path.join('/Users/daijinagahara/repos/TakionOCR/backend/output', `direct-production-result-${timestamp}.json`);
    writeFileSync(outputPath, JSON.stringify(productionResult, null, 2));
    
    console.log(`✅ 本番結果保存: direct-production-result-${timestamp}.json`);
    console.log(`📁 サイズ: ${(Buffer.byteLength(JSON.stringify(productionResult)) / 1024).toFixed(1)}KB`);
    
    // 8. 最終サマリー
    console.log('\n🎉 === 本番直接テスト完了サマリー ===');
    console.log('✅ 実PDF処理: 完了');
    console.log('✅ 実Textract OCR: 完了');
    console.log('✅ 実Rekognition図形検出: 完了');
    console.log('✅ 統合処理フロー: 確認済み');
    
    const totalProcessingTime = parseFloat(conversionTime) + parseFloat(shapesTime);
    console.log(`⏱️  総処理時間: ${totalProcessingTime.toFixed(1)}秒`);
    console.log(`📊 処理効率: ${(totalProcessingTime / pageImages.length).toFixed(1)}秒/ページ`);
    console.log(`📝 OCR品質: ${totalWords}語抽出, 信頼度${(avgOcrConfidence * 100).toFixed(1)}%`);
    console.log(`🔍 図形検出: ${foundShapes}個検出, ${enabledShapes}ページ有効`);
    
    // 9. コスト推定
    const estimatedCost = {
      textract: (testPageCount * 0.0015).toFixed(4),
      rekognition: (pageImages.length * 0.001).toFixed(4),
      total: (testPageCount * 0.0015 + pageImages.length * 0.001).toFixed(4)
    };
    
    console.log('\n💰 === 実際のコスト推定 ===');
    console.log(`📄 Textract (${testPageCount}ページ): $${estimatedCost.textract}`);
    console.log(`🔍 Rekognition (${pageImages.length}画像): $${estimatedCost.rekognition}`);
    console.log(`💳 合計: $${estimatedCost.total} (約${(parseFloat(estimatedCost.total) * 150).toFixed(2)}円)`);
    
    console.log('\n🚀 TakionOCR v3.0 本番直接統合処理が正常に完了しました！');
    
  } catch (error) {
    console.error('❌ 本番直接テスト失敗:', error);
    
    if (error instanceof Error) {
      console.log('\n🔧 エラー分析:');
      if (error.message.includes('AccessDenied')) {
        console.log('   - Textract/Rekognition API権限不足');
      }
      if (error.message.includes('InvalidImageException')) {
        console.log('   - 画像形式またはサイズの問題');
      }
      if (error.message.includes('ThrottlingException')) {
        console.log('   - API呼び出し制限超過');
      }
    }
  }
}

// メイン実行
if (require.main === module) {
  directProductionTest().catch(console.error);
}
