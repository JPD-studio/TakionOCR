import { RekognitionShapeDetector } from '../src/rekognition-shape-detector';
import { Logger } from '../src/logger';

describe('RekognitionShapeDetector', () => {
  let detector: RekognitionShapeDetector;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new Logger('test');
    detector = new RekognitionShapeDetector(mockLogger);
  });

  describe('isEnabled check', () => {
    it('should be disabled by default', () => {
      // プライベートメソッドをテストするため、型キャストを使用
      const isEnabledMethod = (detector as any).isEnabled.bind(detector);
      expect(isEnabledMethod()).toBe(false);
    });

    it('should be enabled when environment variable is true', () => {
      process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'true';
      const isEnabledMethod = (detector as any).isEnabled.bind(detector);
      expect(isEnabledMethod()).toBe(true);
      delete process.env.REKOGNITION_SHAPE_DETECTION_ENABLED;
    });
  });

  describe('shape mapping', () => {
    it('should map labels to correct shapes', () => {
      const mapLabelToShapeMethod = (detector as any).mapLabelToShape.bind(detector);
      
      expect(mapLabelToShapeMethod('Circle')).toBe('circle');
      expect(mapLabelToShapeMethod('Rectangle')).toBe('rectangle');
      expect(mapLabelToShapeMethod('Square')).toBe('rectangle');
      expect(mapLabelToShapeMethod('Ellipse')).toBe('ellipse');
      expect(mapLabelToShapeMethod('Oval')).toBe('ellipse');
      expect(mapLabelToShapeMethod('Trapezoid')).toBe('trapezoid');
      expect(mapLabelToShapeMethod('Unknown Shape')).toBeNull();
    });
  });

  describe('disabled result', () => {
    it('should return disabled result structure', () => {
      const getDisabledResultMethod = (detector as any).getDisabledResult.bind(detector);
      const result = getDisabledResultMethod();
      
      expect(result).toEqual({
        enabled: false,
        shapes: [],
        dominant_shape: 'disabled',
        shape_count: 0
      });
    });
  });

  describe('analyzeDocumentShapes with disabled detection', () => {
    it('should return empty array when disabled', async () => {
      process.env.REKOGNITION_SHAPE_DETECTION_ENABLED = 'false';
      const testBuffer = Buffer.from('test pdf data');
      
      const result = await detector.analyzeDocumentShapes(testBuffer);
      expect(result).toEqual([]);
    });
  });
});
