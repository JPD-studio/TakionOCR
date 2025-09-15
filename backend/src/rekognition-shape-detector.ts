import { 
  RekognitionClient, 
  DetectLabelsCommand,
  Label
} from '@aws-sdk/client-rekognition';
import { Logger } from './logger';
import { ShapeTag, PageShapeAnalysis } from './types';
import { PdfPageImage } from './pdf-image-converter';

export class RekognitionShapeDetector {
  private rekognitionClient = new RekognitionClient({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
  });

  constructor(private logger: Logger) {}

  // 画像バッファから直接図形検出を行う新しいメソッド
  async analyzePageImages(pageImages: PdfPageImage[]): Promise<PageShapeAnalysis[]> {
    if (!this.isEnabled()) {
      this.logger.info('Rekognition shape detection is disabled');
      return pageImages.map(() => this.getDisabledResult());
    }

    try {
      this.logger.info('Starting Rekognition-based shape detection from page images');
      
      const results: PageShapeAnalysis[] = [];

      for (const pageImage of pageImages) {
        this.logger.info(`Analyzing shapes for page ${pageImage.pageNumber} with Rekognition`);
        
        try {
          const shapeAnalysis = await this.analyzePageShapesWithRekognition(pageImage.imageBuffer, pageImage.pageNumber);
          results.push(shapeAnalysis);
        } catch (error) {
          this.logger.warn(`Rekognition analysis failed for page ${pageImage.pageNumber}`, { 
            error: (error as Error).message 
          });
          results.push(this.getDisabledResult());
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Rekognition shape detection failed', { 
        error: (error as Error).message 
      });
      return pageImages.map(() => this.getDisabledResult());
    }
  }

  // 従来のメソッドは非推奨だが互換性のため残す
  async analyzeDocumentShapes(fileBuffer: Buffer): Promise<PageShapeAnalysis[]> {
    if (!this.isEnabled()) {
      this.logger.info('Rekognition shape detection is disabled');
      return [];
    }

    try {
      this.logger.info('Starting Rekognition-based shape detection');
      
      // PDF → 画像変換（ページ毎）
      const images = await this.convertPdfToImages(fileBuffer);
      const results: PageShapeAnalysis[] = [];

      for (let i = 0; i < images.length; i++) {
        const pageNumber = i + 1;
        this.logger.info(`Analyzing shapes for page ${pageNumber} with Rekognition`);
        
        try {
          const shapeAnalysis = await this.analyzePageShapesWithRekognition(images[i], pageNumber);
          results.push(shapeAnalysis);
        } catch (error) {
          this.logger.warn(`Shape analysis failed for page ${pageNumber}`, { 
            error: (error as Error).message 
          });
          results.push(this.getDisabledResult());
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Rekognition shape detection failed', { 
        error: (error as Error).message 
      });
      return [];
    }
  }

  private async analyzePageShapesWithRekognition(imageBuffer: Buffer, pageNumber: number): Promise<PageShapeAnalysis> {
    try {
      // Rekognitionで画像分析
      const command = new DetectLabelsCommand({
        Image: {
          Bytes: imageBuffer
        },
        MaxLabels: 20,
        MinConfidence: 50
      });

      const response = await this.rekognitionClient.send(command);
      
      // ラベルから形状を判定
      const shapeTags = this.extractShapeTags(response.Labels || []);
      
      return {
        enabled: true,
        shapes: shapeTags,
        dominant_shape: this.determineDominantShape(shapeTags),
        shape_count: shapeTags.length
      };

    } catch (error) {
      this.logger.warn(`Rekognition analysis failed for page ${pageNumber}`, { 
        error: (error as Error).message 
      });
      return this.getDisabledResult();
    }
  }

  private extractShapeTags(labels: Label[]): ShapeTag[] {
    const shapeTags: ShapeTag[] = [];
    const detectedLabels = labels.map(label => label.Name || '').filter(name => name);

    // 形状マッピング定義（ざっくり判定）
    const shapeMapping = {
      circle: ['Circle', 'Round', 'Ring', 'Circular', 'Disc'],
      ellipse: ['Ellipse', 'Oval', 'Elliptical'],
      oval: ['Oval', 'Oblong', 'Egg'],
      rectangle: ['Rectangle', 'Rectangular', 'Box', 'Frame'],
      square: ['Square', 'Cube', 'Quadratic'],
      trapezoid: ['Trapezoid', 'Trapeze'],
      triangle: ['Triangle', 'Triangular', 'Pyramid'],
      polygon: ['Polygon', 'Hexagon', 'Pentagon', 'Octagon', 'Diamond']
    };

    // 各形状タイプをチェック
    for (const [shapeType, keywords] of Object.entries(shapeMapping)) {
      const matchedLabels: string[] = [];
      let maxConfidence = 0;

      for (const label of labels) {
        const labelName = label.Name || '';
        const confidence = label.Confidence || 0;

        if (keywords.some(keyword => 
          labelName.toLowerCase().includes(keyword.toLowerCase())
        )) {
          matchedLabels.push(labelName);
          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }

      if (matchedLabels.length > 0) {
        shapeTags.push({
          shape: shapeType as ShapeTag['shape'],
          confidence: Math.round(maxConfidence),
          detected_labels: matchedLabels
        });
      }
    }

    // 形状が検出されない場合は、一般的なラベルから推測
    if (shapeTags.length === 0) {
      const generalShapes = this.inferShapesFromGeneralLabels(detectedLabels);
      shapeTags.push(...generalShapes);
    }

    return shapeTags.slice(0, 5); // 最大5個まで
  }

  private inferShapesFromGeneralLabels(labels: string[]): ShapeTag[] {
    const inferences: ShapeTag[] = [];
    
    // キーワードベースの推論
    const patterns = [
      { keywords: ['gear', 'wheel', 'button', 'coin'], shape: 'circle' as const, confidence: 60 },
      { keywords: ['plate', 'panel', 'screen', 'window'], shape: 'rectangle' as const, confidence: 55 },
      { keywords: ['ball', 'sphere', 'dot'], shape: 'circle' as const, confidence: 65 },
      { keywords: ['tile', 'brick', 'card'], shape: 'rectangle' as const, confidence: 50 }
    ];

    for (const pattern of patterns) {
      const matchedLabels = labels.filter(label =>
        pattern.keywords.some(keyword =>
          label.toLowerCase().includes(keyword.toLowerCase())
        )
      );

      if (matchedLabels.length > 0) {
        inferences.push({
          shape: pattern.shape,
          confidence: pattern.confidence,
          detected_labels: matchedLabels
        });
      }
    }

    return inferences.slice(0, 2); // 推論は最大2個まで
  }

  private determineDominantShape(shapeTags: ShapeTag[]): string {
    if (shapeTags.length === 0) return 'unknown';
    
    // 信頼度が最も高い形状を選択
    const sortedShapes = shapeTags.sort((a, b) => b.confidence - a.confidence);
    return sortedShapes[0].shape;
  }

  // 互換性のための内部PDF変換メソッド（非推奨）
  private async convertPdfToImages(_fileBuffer: Buffer): Promise<Buffer[]> {
    // 新しいPdfImageConverterを使用することを推奨
    // この実装は互換性のためのフォールバック
    this.logger.warn('Using deprecated convertPdfToImages method. Consider using PdfImageConverter.');
    
    // 最小限の実装（エラー処理のみ）
    throw new Error('This method is deprecated. Use PdfImageConverter and analyzePageImages instead.');
  }

  private isEnabled(): boolean {
    // 環境変数でオンオフ制御
    const enabled = process.env.REKOGNITION_SHAPE_DETECTION_ENABLED;
    return enabled === 'true' || enabled === '1';
  }

  private getDisabledResult(): PageShapeAnalysis {
    return {
      enabled: false,
      shapes: [],
      dominant_shape: 'disabled',
      shape_count: 0
    };
  }
}
