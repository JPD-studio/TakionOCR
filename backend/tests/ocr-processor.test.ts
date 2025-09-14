import { OcrProcessor } from '../src/ocr-processor';
import { TextractClient } from '@aws-sdk/client-textract';
import { Logger } from '../src/logger';

jest.mock('@aws-sdk/client-textract');

describe('OcrProcessor - performTextractAnalyzeOcr', () => {
  let ocrProcessor: OcrProcessor;
  let textractClientMock: jest.Mocked<TextractClient>;

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(), // セミコロンを追加
  };

  beforeEach(() => {
    textractClientMock = new TextractClient({}) as jest.Mocked<TextractClient>;
    ocrProcessor = new OcrProcessor(mockLogger as unknown as Logger);
    ocrProcessor['textractClient'] = textractClientMock;
  });

  it('should extract forms and tables correctly', async () => {
    const fileBuffer = Buffer.from('mock image data');

    textractClientMock.send = jest.fn().mockResolvedValue({
      Blocks: [
        { BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: '1', Relationships: [{ Type: 'VALUE', Ids: ['2'] }] },
        { BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: '2', Text: 'Sample Value' },
        { BlockType: 'TABLE', Id: '3', Relationships: [{ Type: 'CHILD', Ids: ['4'] }] },
        { BlockType: 'CELL', Id: '4', RowIndex: 1, ColumnIndex: 1, Text: 'Cell Text' }
      ]
    });

    const result = await ocrProcessor['performTextractAnalyzeOcr'](fileBuffer, {
      textractEnabled: true,
      maxPagesPerMonth: 1000,
      maxFileSize: 10,
      maxPagesPerFile: 10,
      ocrTimeout: 30,
      maxRetryAttempts: 3
    }, Date.now());

    expect(result.forms).toEqual([{ key: 'Sample Key', value: 'Sample Value' }]);
    expect(result.tables).toEqual([
      {
        cells: [
          { text: 'Cell Text', rowIndex: 1, columnIndex: 1 }
        ]
      }
    ]);
  });
});
