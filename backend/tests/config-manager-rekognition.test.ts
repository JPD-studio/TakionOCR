import { ConfigManager } from '../src/config-manager';

describe('ConfigManager - Rekognition Integration', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    configManager = new ConfigManager();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.REKOGNITION_SHAPE_DETECTION_ENABLED;
  });

  it('should return default rekognitionEnabled as false when parameter not set', async () => {
    // Mock Parameter Store to return undefined for rekognition setting
    const getParameterSpy = jest.spyOn(configManager as any, 'getParameter');
    getParameterSpy.mockImplementation((name: string) => {
      if (name === '/config/pdf-ocr/rekognition-shape-detection-enabled') {
        return Promise.resolve('false');
      }
      return Promise.resolve('1000'); // default value for other params
    });

    const config = await configManager.getConfig();
    expect(config.rekognitionEnabled).toBe(false);
    
    getParameterSpy.mockRestore();
  });

  it('should return rekognitionEnabled as true when parameter is true', async () => {
    // Mock Parameter Store to return 'true' for rekognition setting
    const getParameterSpy = jest.spyOn(configManager as any, 'getParameter');
    getParameterSpy.mockImplementation((name: string) => {
      if (name === '/config/pdf-ocr/rekognition-shape-detection-enabled') {
        return Promise.resolve('true');
      }
      return Promise.resolve('1000'); // default value for other params
    });

    const config = await configManager.getConfig();
    expect(config.rekognitionEnabled).toBe(true);
    
    getParameterSpy.mockRestore();
  });
});
