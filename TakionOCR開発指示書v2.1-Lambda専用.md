# TakionOCR - Lambda開発指示書 v2.1（Lambda開発者専用版）

------

## 0. Lambda開発者の責任範囲

**あなたの担当範囲:**
- Lambda関数のコード実装 (`src/lambda-handler.ts`)
- OCRロジック (Textract/Tesseract連携)
- エラーハンドリング・リトライロジック
- 料金制限チェック機能
- ログ出力・構造化ログ
- 入力検証・セキュリティチェック
- パフォーマンス最適化

**他の開発者の担当範囲:**
- AWS SAMテンプレート・インフラ設定
- S3バケット・DynamoDB・SQS設定
- CloudWatch Alarms・Parameter Store設定
- Amplify Hosting・CI/CDパイプライン
- バックアップ・DR設定

### 0.1 開発環境セットアップ

```bash
# リポジトリクローン後
cd backend
npm install

# 環境変数設定
cp .env.example .env.local
# 必要に応じて値を編集
```

------

## 第1章: Lambda関数仕様

### 1.1 エントリーポイント

**ファイル:** `backend/src/lambda-handler.ts`

```typescript
import { S3Event, Context } from 'aws-lambda';
import { OcrProcessor } from './ocr-processor';
import { UsageManager } from './usage-manager';
import { Logger } from './logger';

export const handler = async (event: S3Event, context: Context): Promise<void> => {
  const logger = new Logger(context.awsRequestId);
  
  try {
    // S3イベントからファイル情報を取得
    const records = event.Records;
    
    for (const record of records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      logger.info('Processing started', { bucket, key });
      
      // OCR処理実行
      const processor = new OcrProcessor(logger);
      await processor.processFile(bucket, key);
      
      logger.info('Processing completed', { bucket, key });
    }
  } catch (error) {
    logger.error('Lambda execution failed', { error: error.message });
    throw error;
  }
};
```

### 1.2 環境変数の使用

**Lambda環境変数（他の開発者が設定）:**

```typescript
// 環境変数の取得方法
const config = {
  inputBucket: process.env.S3_INPUT_BUCKET!,
  outputBucket: process.env.S3_OUTPUT_BUCKET!,
  usageTable: process.env.DYNAMODB_USAGE_TABLE!,
  dlqUrl: process.env.DLQ_URL!,
  nodeEnv: process.env.NODE_ENV || 'development'
};
```

### 1.3 Parameter Store連携

```typescript
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';

export class ConfigManager {
  private ssmClient = new SSMClient({});
  private cache = new Map<string, { value: string; expires: number }>();
  
  async getParameter(name: string): Promise<string> {
    // 5分間キャッシュ
    const cached = this.cache.get(name);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
    
    const command = new GetParametersCommand({
      Names: [name],
      WithDecryption: true
    });
    
    const response = await this.ssmClient.send(command);
    const value = response.Parameters?.[0]?.Value || '';
    
    this.cache.set(name, {
      value,
      expires: Date.now() + 5 * 60 * 1000 // 5分
    });
    
    return value;
  }
  
  async getConfig(): Promise<OcrConfig> {
    const [
      textractEnabled,
      tesseractEnabled,
      maxPagesPerMonth,
      maxFileSize,
      maxPagesPerFile,
      ocrTimeout,
      maxRetryAttempts
    ] = await Promise.all([
      this.getParameter('/config/pdf-ocr/textract-enabled'),
      this.getParameter('/config/pdf-ocr/tesseract-enabled'),
      this.getParameter('/config/pdf-ocr/max-pages-per-month'),
      this.getParameter('/config/pdf-ocr/max-file-size-mb'),
      this.getParameter('/config/pdf-ocr/max-pages-per-file'),
      this.getParameter('/config/pdf-ocr/ocr-timeout-seconds'),
      this.getParameter('/config/pdf-ocr/max-retry-attempts')
    ]);
    
    return {
      textractEnabled: textractEnabled === 'true',
      tesseractEnabled: tesseractEnabled === 'true',
      maxPagesPerMonth: parseInt(maxPagesPerMonth) || 1000,
      maxFileSize: parseInt(maxFileSize) || 10,
      maxPagesPerFile: parseInt(maxPagesPerFile) || 50,
      ocrTimeout: parseInt(ocrTimeout) || 300,
      maxRetryAttempts: parseInt(maxRetryAttempts) || 3
    };
  }
}
```

------

## 第2章: OCR処理ロジック

### 2.1 メイン処理クラス

```typescript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { createWorker } from 'tesseract.js';
import * as pdfParse from 'pdf-parse';

export class OcrProcessor {
  private s3Client = new S3Client({});
  private textractClient = new TextractClient({});
  private configManager = new ConfigManager();
  private usageManager = new UsageManager();
  
  constructor(private logger: Logger) {}
  
  async processFile(bucket: string, key: string): Promise<void> {
    try {
      // 1. 設定取得
      const config = await this.configManager.getConfig();
      
      // 2. ファイル取得・検証
      const fileBuffer = await this.getFileFromS3(bucket, key);
      await this.validateFile(fileBuffer, config);
      
      // 3. 料金制限チェック
      const pageCount = await this.getPageCount(fileBuffer);
      await this.usageManager.checkUsageLimit(pageCount);
      
      // 4. OCR実行
      const result = await this.performOcr(fileBuffer, config);
      
      // 5. 結果保存
      await this.saveResult(key, result);
      
      // 6. 使用量更新
      await this.usageManager.updateUsage(pageCount);
      
    } catch (error) {
      await this.handleError(key, error);
      throw error;
    }
  }
  
  private async performOcr(fileBuffer: Buffer, config: OcrConfig): Promise<OcrResult> {
    const startTime = Date.now();
    
    try {
      // Textractを優先使用
      if (config.textractEnabled) {
        return await this.performTextractOcr(fileBuffer, config);
      } else if (config.tesseractEnabled) {
        return await this.performTesseractOcr(fileBuffer, config);
      } else {
        throw new Error('No OCR engine is enabled');
      }
    } finally {
      const duration = Date.now() - startTime;
      this.logger.info('OCR processing completed', { duration });
    }
  }
}
```

### 2.2 Textract連携

```typescript
private async performTextractOcr(fileBuffer: Buffer, config: OcrConfig): Promise<OcrResult> {
  const command = new DetectDocumentTextCommand({
    Document: {
      Bytes: fileBuffer
    }
  });
  
  // タイムアウト・リトライ付き実行
  const response = await this.executeWithRetry(
    () => this.textractClient.send(command),
    config.maxRetryAttempts,
    config.ocrTimeout * 1000
  );
  
  // 結果変換
  const extractedText = response.Blocks
    ?.filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n') || '';
  
  return {
    success: true,
    engine: 'textract',
    text: extractedText,
    confidence: this.calculateAverageConfidence(response.Blocks),
    pageCount: await this.getPageCount(fileBuffer),
    processingTime: Date.now() - Date.now() // 実際の処理時間を計算
  };
}
```

### 2.3 Tesseract連携

```typescript
private async performTesseractOcr(fileBuffer: Buffer, config: OcrConfig): Promise<OcrResult> {
  const worker = await createWorker('jpn+eng');
  
  try {
    // PDF → 画像変換が必要（実装は省略）
    const images = await this.convertPdfToImages(fileBuffer);
    
    let extractedText = '';
    let totalConfidence = 0;
    
    for (const image of images) {
      const { data } = await worker.recognize(image);
      extractedText += data.text + '\n';
      totalConfidence += data.confidence;
    }
    
    return {
      success: true,
      engine: 'tesseract',
      text: extractedText.trim(),
      confidence: totalConfidence / images.length,
      pageCount: images.length,
      processingTime: Date.now() - Date.now() // 実際の処理時間を計算
    };
  } finally {
    await worker.terminate();
  }
}
```

------

## 第3章: エラーハンドリング・リトライ

### 3.1 エラー分類

```typescript
export enum ErrorType {
  FILE_ERROR = 'FILE_ERROR',
  SIZE_LIMIT_ERROR = 'SIZE_LIMIT_ERROR',
  PAGE_LIMIT_ERROR = 'PAGE_LIMIT_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  OCR_ENGINE_ERROR = 'OCR_ENGINE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  SECURITY_ERROR = 'SECURITY_ERROR',
  PARTIAL_FAILURE = 'PARTIAL_FAILURE'
}

export class OcrError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
```

### 3.2 リトライロジック

```typescript
export class RetryManager {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number,
    timeoutMs: number
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // タイムアウト付き実行
        return await Promise.race([
          operation(),
          this.createTimeoutPromise(timeoutMs)
        ]);
      } catch (error) {
        lastError = error;
        
        // リトライ不可能なエラーは即座に失敗
        if (!this.isRetryableError(error)) {
          throw error;
        }
        
        // 最後の試行でない場合は待機
        if (attempt < maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError!;
  }
  
  private calculateBackoffDelay(attempt: number): number {
    // 指数バックオフ: 1秒, 2秒, 4秒, 8秒...
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
  }
  
  private isRetryableError(error: any): boolean {
    // AWS SDK エラーの場合
    if (error.name === 'ThrottlingException') return true;
    if (error.name === 'ServiceUnavailableException') return true;
    if (error.name === 'InternalServerError') return true;
    
    // カスタムエラーの場合
    if (error instanceof OcrError) return error.retryable;
    
    return false;
  }
}
```

------

## 第4章: 料金制限チェック

### 4.1 使用量管理

```typescript
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export class UsageManager {
  private dynamoClient = new DynamoDBClient({});
  private tableName = process.env.DYNAMODB_USAGE_TABLE!;
  
  async checkUsageLimit(additionalPages: number): Promise<void> {
    const currentMonth = this.getCurrentMonthKey();
    const usage = await this.getCurrentUsage(currentMonth);
    const config = await new ConfigManager().getConfig();
    
    if (usage.totalPages + additionalPages > config.maxPagesPerMonth) {
      throw new OcrError(
        ErrorType.QUOTA_EXCEEDED,
        `Monthly page limit exceeded: ${usage.totalPages + additionalPages}/${config.maxPagesPerMonth}`,
        false,
        { currentUsage: usage.totalPages, limit: config.maxPagesPerMonth }
      );
    }
    
    // アラート閾値チェック（80%）
    const threshold = config.maxPagesPerMonth * 0.8;
    if (usage.totalPages + additionalPages > threshold) {
      this.logger.warn('Usage approaching limit', {
        currentUsage: usage.totalPages,
        limit: config.maxPagesPerMonth,
        threshold
      });
    }
  }
  
  async updateUsage(pageCount: number): Promise<void> {
    const currentMonth = this.getCurrentMonthKey();
    
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: {
        PK: { S: currentMonth },
        SK: { S: 'TOTAL' }
      },
      UpdateExpression: 'ADD totalPages :pages, totalFiles :files SET lastUpdated = :timestamp',
      ExpressionAttributeValues: {
        ':pages': { N: pageCount.toString() },
        ':files': { N: '1' },
        ':timestamp': { S: new Date().toISOString() }
      }
    });
    
    await this.dynamoClient.send(command);
  }
  
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `USAGE#${now.getFullYear()}#${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
```

------

## 第5章: 入力検証・セキュリティ

### 5.1 ファイル検証

```typescript
import * as Joi from 'joi';
import * as pdfParse from 'pdf-parse';

export class FileValidator {
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly maxPages = 50;
  
  async validateFile(fileBuffer: Buffer, config: OcrConfig): Promise<void> {
    // ファイルサイズチェック
    if (fileBuffer.length > this.maxFileSize) {
      throw new OcrError(
        ErrorType.SIZE_LIMIT_ERROR,
        `File size exceeds limit: ${fileBuffer.length}/${this.maxFileSize} bytes`
      );
    }
    
    // PDF形式チェック
    if (!this.isPdfFile(fileBuffer)) {
      throw new OcrError(
        ErrorType.FILE_ERROR,
        'Invalid file format. Only PDF files are supported.'
      );
    }
    
    // ページ数チェック
    const pageCount = await this.getPageCount(fileBuffer);
    if (pageCount > this.maxPages) {
      throw new OcrError(
        ErrorType.PAGE_LIMIT_ERROR,
        `Page count exceeds limit: ${pageCount}/${this.maxPages} pages`
      );
    }
    
    // セキュリティチェック
    await this.performSecurityCheck(fileBuffer);
  }
  
  private isPdfFile(buffer: Buffer): boolean {
    // PDFファイルのマジックナンバーチェック
    return buffer.subarray(0, 4).toString() === '%PDF';
  }
  
  private async performSecurityCheck(fileBuffer: Buffer): Promise<void> {
    try {
      // PDF解析による基本的なセキュリティチェック
      const pdfData = await pdfParse(fileBuffer);
      
      // 暗号化されたPDFの検出
      if (pdfData.info?.IsEncrypted) {
        throw new OcrError(
          ErrorType.SECURITY_ERROR,
          'Encrypted PDF files are not supported'
        );
      }
      
      // 異常に大きなメタデータの検出
      if (JSON.stringify(pdfData.info).length > 10000) {
        throw new OcrError(
          ErrorType.SECURITY_ERROR,
          'PDF contains suspicious metadata'
        );
      }
      
    } catch (error) {
      if (error instanceof OcrError) throw error;
      
      throw new OcrError(
        ErrorType.FILE_ERROR,
        'Failed to parse PDF file',
        false,
        { originalError: error.message }
      );
    }
  }
}
```

------

## 第6章: ログ・監視

### 6.1 構造化ログ

```typescript
export class Logger {
  constructor(private requestId: string) {}
  
  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }
  
  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }
  
  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }
  
  debug(message: string, data?: any): void {
    this.log('DEBUG', message, data);
  }
  
  private log(level: string, message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'takion-ocr',
      version: '2.1',
      requestId: this.requestId,
      message,
      data,
      environment: process.env.NODE_ENV || 'development'
    };
    
    // CloudWatch Logsに出力
    console.log(JSON.stringify(logEntry));
  }
}
```

### 6.2 メトリクス送信

```typescript
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export class MetricsService {
  private cloudWatchClient = new CloudWatchClient({});
  
  async recordProcessingTime(
    engine: string,
    pageCount: number,
    duration: number
  ): Promise<void> {
    const command = new PutMetricDataCommand({
      Namespace: 'TakionOCR/Performance',
      MetricData: [
        {
          MetricName: 'ProcessingTime',
          Value: duration,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Engine', Value: engine },
            { Name: 'PageCount', Value: pageCount.toString() }
          ]
        }
      ]
    });
    
    await this.cloudWatchClient.send(command);
  }
  
  async recordError(errorType: string): Promise<void> {
    const command = new PutMetricDataCommand({
      Namespace: 'TakionOCR/Errors',
      MetricData: [
        {
          MetricName: 'ErrorCount',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'ErrorType', Value: errorType }
          ]
        }
      ]
    });
    
    await this.cloudWatchClient.send(command);
  }
}
```

------

## 第7章: テスト・デバッグ

### 7.1 ローカルテスト

```typescript
// tests/lambda-handler.test.ts
import { handler } from '../src/lambda-handler';
import { S3Event } from 'aws-lambda';

describe('Lambda Handler', () => {
  const mockS3Event: S3Event = {
    Records: [
      {
        s3: {
          bucket: { name: 'test-bucket' },
          object: { key: 'input/test.pdf' }
        }
      } as any
    ]
  };
  
  beforeEach(() => {
    // モック設定
    process.env.S3_INPUT_BUCKET = 'test-input-bucket';
    process.env.S3_OUTPUT_BUCKET = 'test-output-bucket';
    process.env.DYNAMODB_USAGE_TABLE = 'test-usage-table';
  });
  
  test('should process PDF file successfully', async () => {
    // テスト実装
    await expect(handler(mockS3Event, {} as any)).resolves.not.toThrow();
  });
});
```

### 7.2 ローカル実行

```bash
# ローカルでのテスト実行
npm run test

# 特定のファイルでのテスト
npm run test:local -- --file samples/test.pdf

# デバッグモード
npm run dev:debug
```

------

## 付録A: Lambda開発用API仕様

### A.1 S3イベント構造

```typescript
interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
  eventName: string; // 's3:ObjectCreated:Put'
}
```

### A.2 出力JSON形式

```typescript
interface OcrResult {
  success: boolean;
  engine: 'textract' | 'tesseract';
  text: string;
  confidence?: number;
  pageCount: number;
  processingTime: number;
  error?: {
    type: ErrorType;
    message: string;
    details?: any;
  };
}
```

------

## 付録B: 環境変数・設定リファレンス

### B.1 Lambda環境変数（他の開発者が設定）

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `S3_INPUT_BUCKET` | ○ | 入力用S3バケット名 |
| `S3_OUTPUT_BUCKET` | ○ | 出力用S3バケット名 |
| `DYNAMODB_USAGE_TABLE` | ○ | 使用量管理テーブル名 |
| `DLQ_URL` | ○ | Dead Letter Queue URL |
| `NODE_ENV` | ○ | 実行環境 |

### B.2 Parameter Store設定（他の開発者が設定）

| パラメータ名 | 型 | 説明 |
|--------------|----|----- |
| `/config/pdf-ocr/textract-enabled` | String | Textract有効化 |
| `/config/pdf-ocr/tesseract-enabled` | String | Tesseract有効化 |
| `/config/pdf-ocr/max-pages-per-month` | String | 月間制限 |
| `/config/pdf-ocr/max-file-size-mb` | String | ファイルサイズ制限 |
| `/config/pdf-ocr/max-pages-per-file` | String | ページ数制限 |
| `/config/pdf-ocr/ocr-timeout-seconds` | String | タイムアウト時間 |
| `/config/pdf-ocr/max-retry-attempts` | String | リトライ回数 |

------

## 付録C: Lambda固有のトラブルシューティング

### C.1 よくある問題

**問題1: Lambda関数がタイムアウトする**
```
症状: 処理が5分でタイムアウトする
原因: 大容量ファイルまたは複雑なPDF
解決: ファイル分割処理、並列処理の実装
```

**問題2: メモリ不足エラー**
```
症状: "Runtime exited with error: signal: killed"
原因: Lambda関数のメモリ制限
解決: メモリサイズの最適化（他の開発者に依頼）
```

**問題3: コールドスタート遅延**
```
症状: 初回実行が遅い
原因: Lambda関数の初期化時間
解決: 初期化処理のグローバルスコープ移動
```

### C.2 デバッグ方法

```typescript
// CloudWatch Logsでの検索クエリ例
fields @timestamp, level, message, requestId
| filter level = "ERROR"
| sort @timestamp desc
| limit 100
```

------

## 変更履歴

### v2.1 (2025-09-14)
- **Lambda開発者専用版を作成**
- インフラ関連の詳細を除外
- Lambda固有の実装に特化
- 他の開発者との責任分担を明確化

------

**文書作成者**: Devin AI  
**最終更新**: 2025年9月14日  
**バージョン**: 2.1（Lambda開発者専用）  
**対象**: Lambda関数開発者
