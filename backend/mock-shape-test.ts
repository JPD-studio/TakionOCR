import { RekognitionShapeDetector } from './src/rekognition-shape-detector';
import { Logger } from './src/logger';
import { readFileSync, writeFileSync } from 'fs';
import { PageShapeAnalysis, ShapeTag } from './src/types';

async function testShapeDetectionOutput(): Promise<void> {
  console.log('=== Shape Detection Output Format Test ===\n');
  
  const logger = new Logger('shape-output-test');
  
  // 実際のAWSが使えない場合のモック結果を作成
  console.log('Creating mock shape detection results for demonstration...\n');
  
  const mockShapeResults: PageShapeAnalysis[] = [
    // Page 1: Engineering drawing with circles and rectangles
    {
      enabled: true,
      shape_count: 4,
      dominant_shape: 'circle',
      shapes: [
        { shape: 'circle', confidence: 0.92, detected_labels: ['Circle', 'Wheel'] },
        { shape: 'circle', confidence: 0.88, detected_labels: ['Circle', 'Hole'] },
        { shape: 'rectangle', confidence: 0.85, detected_labels: ['Rectangle', 'Frame'] },
        { shape: 'rectangle', confidence: 0.79, detected_labels: ['Square', 'Box'] }
      ]
    },
    // Page 2: Triangular components
    {
      enabled: true,
      shape_count: 3,
      dominant_shape: 'triangle',
      shapes: [
        { shape: 'triangle', confidence: 0.91, detected_labels: ['Triangle', 'Arrow'] },
        { shape: 'triangle', confidence: 0.87, detected_labels: ['Triangle'] },
        { shape: 'rectangle', confidence: 0.82, detected_labels: ['Rectangle'] }
      ]
    },
    // Page 3: Mixed shapes
    {
      enabled: true,
      shape_count: 5,
      dominant_shape: 'rectangle',
      shapes: [
        { shape: 'rectangle', confidence: 0.94, detected_labels: ['Rectangle', 'Frame'] },
        { shape: 'rectangle', confidence: 0.89, detected_labels: ['Square'] },
        { shape: 'ellipse', confidence: 0.86, detected_labels: ['Ellipse', 'Oval'] },
        { shape: 'circle', confidence: 0.83, detected_labels: ['Circle'] },
        { shape: 'trapezoid', confidence: 0.76, detected_labels: ['Trapezoid'] }
      ]
    },
    // Page 4: Mostly circular components (wheels, holes, etc.)
    {
      enabled: true,
      shape_count: 6,
      dominant_shape: 'circle',
      shapes: [
        { shape: 'circle', confidence: 0.96, detected_labels: ['Circle', 'Wheel', 'Round'] },
        { shape: 'circle', confidence: 0.93, detected_labels: ['Circle', 'Hole'] },
        { shape: 'circle', confidence: 0.89, detected_labels: ['Circle'] },
        { shape: 'circle', confidence: 0.85, detected_labels: ['Circle', 'Button'] },
        { shape: 'rectangle', confidence: 0.81, detected_labels: ['Rectangle'] },
        { shape: 'ellipse', confidence: 0.78, detected_labels: ['Ellipse'] }
      ]
    }
  ];
  
  // 完整なOcrResult形式で出力
  const mockOcrResult = {
    engine: 'textract-analyze',
    inputFile: 'サンプル図面２.pdf',
    fileSize: 4445456,
    pageCount: 4,
    processingTimeMs: 15432,
    pages: mockShapeResults.map((shapes, index) => ({
      pageNumber: index + 1,
      text: `Engineering drawing page ${index + 1} content...`,
      confidence: 94.2,
      blockCount: 25,
      shapes: shapes  // 図形検出結果がここに入る
    })),
    forms: [],
    tables: [],
    metadata: {
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      region: 'us-east-1'
    }
  };
  
  // 結果をファイルに保存
  const outputPath = '/Users/daijinagahara/repos/TakionOCR/backend/output/mock-shape-detection-result.json';
  writeFileSync(outputPath, JSON.stringify(mockOcrResult, null, 2));
  
  console.log('✅ Mock shape detection results created!');
  console.log(`📁 Output file: ${outputPath}\n`);
  
  // サマリー表示
  console.log('=== Shape Detection Results Summary ===');
  mockShapeResults.forEach((page, index) => {
    console.log(`\nPage ${index + 1}:`);
    console.log(`  🎯 Dominant shape: ${page.dominant_shape}`);
    console.log(`  📊 Total shapes: ${page.shape_count}`);
    console.log(`  🔍 Detected shapes:`);
    page.shapes.forEach(shape => {
      const percentage = (shape.confidence * 100).toFixed(1);
      const labels = shape.detected_labels.join(', ');
      console.log(`     - ${shape.shape}: ${percentage}% (${labels})`);
    });
  });
  
  console.log('\n=== Shape Type Distribution ===');
  const shapeCount = {
    circle: 0, rectangle: 0, triangle: 0, ellipse: 0, trapezoid: 0
  };
  
  mockShapeResults.forEach(page => {
    page.shapes.forEach(shape => {
      if (shape.shape in shapeCount) {
        (shapeCount as any)[shape.shape]++;
      }
    });
  });
  
  Object.entries(shapeCount).forEach(([shape, count]) => {
    if (count > 0) {
      console.log(`  ${shape}: ${count}個`);
    }
  });
  
  console.log('\n🎉 This is what the actual results would look like with proper AWS configuration!');
}

if (require.main === module) {
  testShapeDetectionOutput();
}
