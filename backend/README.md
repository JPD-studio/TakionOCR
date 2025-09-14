# TakionOCR Backend

AWS Lambda対応PDF OCRシステムの TypeScript バックエンド実装

## アーキテクチャ概要

本システムは AWS Lambda での本番運用を前提として設計され、以下の特徴を持ちます：

### Lambda 最適化アーキテクチャ

#### S3 ベース非同期処理
- PDF ファイルを S3 に配置
- `StartDocumentAnalysis` による非同期処理（Lambda 15分制限対応）
- `GetDocumentAnalysis` でのポーリング
- `pdf2pic` による同期処理は除外（メモリ・実行時間制限のため）

#### コンテナイメージ対応
- Lambda Container Image による柔軟なデプロイ
- S3 イベントトリガー対応
- 非同期処理パターン
- Lambda 固有のエラーハンドリング

#### ページ毎構造化処理
- フォームとテーブルをページ単位で分析
- 2D配列形式のテーブル構造化（`rows[][]`）
- セル位置情報（`rowIndex`, `columnIndex`）
- ローカルテスト環境（実際の AWS サービス使用）

## TypeScript ファイル一覧

### Lambda デプロイ必須ファイル

| ファイル | 説明 | 使用状況 | 備考 |
|---------|------|----------|------|
| `lambda-handler.ts` | Lambda エントリーポイント（S3イベント処理） | アクティブ | Production ready |
| `lambda-ocr-processor.ts` | S3ベース非同期OCR処理（Textract統合） | アクティブ | StartDocumentAnalysis使用 |
| `types.ts` | 型定義（OcrResult, TableCell, Form等） | アクティブ | ページレベル構造対応 |
| `logger.ts` | 構造化ログ出力（Lambda対応） | アクティブ | CloudWatch統合 |
| `config-manager.ts` | 環境設定管理（AWS設定） | アクティブ | S3/Textract設定 |
| `errors.ts` | カスタムエラー定義（OcrError） | アクティブ | 統一エラーハンドリング |

### ローカル開発専用ファイル

| ファイル | 説明 | 使用状況 | 備考 |
|---------|------|----------|------|
| `local-s3-runner.ts` | ローカルS3テスト実行（Lambda動作模擬） | アクティブ | LocalStack対応 |
| `local-runner.ts` | 直接ファイル処理（簡単テスト用） | アクティブ | 開発時利用 |
| `test-file-processor.ts` | 複数ファイル一括テスト | アクティブ | バッチテスト用 |

### 機能拡張ファイル（条件付きデプロイ）

| ファイル | 説明 | 使用状況 | デプロイ条件 |
|---------|------|----------|-------------|
| `usage-manager.ts` | DynamoDB使用量追跡 | 実装済み・未使用 | 使用量制限が必要な場合 |
| `text-filter.ts` | 技術文書特化フィルタリング | 実装済み・未使用 | 図面/技術文書処理時 |
| `batch-processor.ts` | S3バッチ処理 | 実装済み・未使用 | 大量ファイル処理時 |
| `file-utils.ts` | ファイル操作ユーティリティ | 実装済み・未使用 | ローカルファイル処理時 |
| `s3-utils.ts` | S3操作ヘルパー | 実装済み・未使用 | 複雑なS3操作時 |

### レガシー/非推奨ファイル（デプロイ不要）

| ファイル | 説明 | 使用状況 | 備考 |
|---------|------|----------|------|
| `ocr-processor.ts` | 同期OCR処理（pdf2pic使用） | 非推奨 | Lambda制限により廃止 |
| `pdf-processor.ts` | PDF直接処理 | 非推奨 | S3ベース処理に移行 |
| `image-processor.ts` | 画像処理機能 | 未実装 | 将来機能 |
| `validation.ts` | 入力検証 | 未実装 | API統合時追加予定 |

## 開発・テスト環境

### ローカルテスト方法

#### 1. S3ベーステスト（推奨 - Lambda環境模擬）

```bash
# 実際の AWS サービスを使用
export AWS_PROFILE=your-profile
export AWS_DEFAULT_REGION=us-east-1

npm run ocr-s3-local -- --file="../samples/test-documents/サンプル図面２.pdf" --output="../output/lambda-test.json" --bucket=your-test-bucket
```

#### 2. LocalStack使用（オフライン開発環境）

```bash
# LocalStack を起動
docker run --rm -it -p 4566:4566 localstack/localstack

# LocalStack でテスト
npm run ocr-s3-local -- --file="../samples/test-documents/サンプル図面２.pdf" --output="../output/lambda-test.json" --localstack
```

#### 3. 従来方式テスト（開発用）

```bash
npm run ocr-local -- --file="../samples/test-documents/サンプル図面２.pdf" --output="../output/result.json" --engine="textract-analyze"
```

### package.json スクリプト

```json
{
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "ocr-local": "ts-node src/local-runner.ts",
    "ocr-s3-local": "ts-node src/local-s3-runner.ts",
    "lambda-test": "ts-node src/local-s3-runner.ts"
  }
}
```

## AWS Lambda デプロイ

### 1. Docker ビルド & ECR プッシュ

```bash
# TypeScript コンパイル
npm run build

# Docker イメージ作成
docker build -t takion-ocr-lambda .

# ECR リポジトリ作成（初回のみ）
aws ecr create-repository --repository-name takion-ocr-lambda

# ECR へプッシュ
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
docker tag takion-ocr-lambda:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest
```

### 2. Lambda 関数作成

```bash
aws lambda create-function \
  --function-name takion-ocr-processor \
  --package-type Image \
  --code ImageUri=123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest \
  --role arn:aws:iam::123456789012:role/lambda-textract-role \
  --timeout 900 \
  --memory-size 1024 \
  --environment Variables='{OUTPUT_BUCKET=takion-ocr-results}'
```

### 3. S3 イベントトリガー設定

```bash
aws s3api put-bucket-notification-configuration \
  --bucket your-input-bucket \
  --notification-configuration '{
    "LambdaConfigurations": [{
      "Id": "takion-ocr-trigger",
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:takion-ocr-processor",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [{
            "Name": "suffix",
            "Value": ".pdf"
          }]
        }
      }
    }]
  }'
```

## 必要な IAM 権限

Lambda 実行ロールに以下のポリシーをアタッチ：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "textract:StartDocumentAnalysis",
        "textract:GetDocumentAnalysis"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::your-input-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::your-output-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

## 設定・環境変数

### Lambda 環境変数

| 変数名 | 説明 | デフォルト |
|-------|------|----------|
| `AWS_DEFAULT_REGION` | AWS リージョン | `us-east-1` |
| `OUTPUT_BUCKET` | 結果出力S3バケット | 入力バケット |
| `TEXTRACT_TIMEOUT` | Textract タイムアウト（秒） | `900` |
| `MAX_RETRY_ATTEMPTS` | リトライ最大回数 | `3` |

### SSM Parameter Store（オプション）

- `/config/pdf-ocr/MAX_PAGES_PER_MONTH`: 月間ページ数制限
- `/config/pdf-ocr/MAX_FILE_SIZE`: ファイルサイズ制限
- `/config/pdf-ocr/OCR_TIMEOUT`: OCRタイムアウト

## ファイル詳細説明

### コアファイル

#### `lambda-handler.ts`
- **役割**: AWS Lambda のエントリーポイント
- **機能**: S3 イベント受信、エラーハンドリング、ログ出力
- **デプロイ**: 必須

```typescript
export const handler = async (event: S3Event, context: Context): Promise<void>
```

#### `lambda-ocr-processor.ts`
- **役割**: S3 ベース非同期 OCR 処理
- **機能**: 
  - StartDocumentAnalysis による非同期 Textract 開始
  - GetDocumentAnalysis でのポーリング
  - ページ毎のフォーム・テーブル抽出
  - 2D 配列形式のテーブル構造化
- **デプロイ**: 必須
- **特徴**: Lambda 15分制限対応、大容量PDF処理可能

#### `types.ts`
- **役割**: システム全体の型定義
- **機能**: 
  - `OcrResult`: OCR結果の統一フォーマット（ページ毎分析対応）
  - `Table`, `TableCell`: テーブル構造定義
  - `ErrorType`: エラー種別定義
- **デプロイ**: 必須

### ローカル開発ファイル

#### `local-s3-runner.ts`
- **役割**: Lambda 環境模擬テスト
- **機能**:
  - 実際の AWS S3, Textract 使用
  - LocalStack 対応
  - バケット自動作成
  - 結果プレビュー表示
- **デプロイ**: ローカル専用

```bash
npm run ocr-s3-local -- --file="sample.pdf" --output="result.json"
```

#### `local-runner.ts`
- **役割**: 従来のローカル実行
- **機能**: pdf2pic 使用、同期処理
- **デプロイ**: ローカル専用
- **注意**: 本番非推奨（メモリ・時間制限）

## 処理フロー

### Lambda 本番フロー

1. **S3 イベント受信** (`lambda-handler.ts`)
2. **ファイル取得** (`lambda-ocr-processor.ts`)
3. **Textract 非同期開始** (`StartDocumentAnalysis`)
4. **結果ポーリング** (`GetDocumentAnalysis`)
5. **ページ毎構造化** (フォーム・テーブル)
6. **S3 結果保存** (`PutObject`)

### ローカルテストフロー

1. **ファイル読み込み** (`local-s3-runner.ts`)
2. **S3 アップロード** (`PutObject`)
3. **Lambda プロセッサー実行** (上記と同様)
4. **ローカルファイル保存**

## 出力フォーマット

### OCR結果構造（ページ毎分析対応）

```typescript
interface OcrResult {
  engine: string;           // "textract-analyze"
  pageCount: number;        // ページ数
  processingTimeMs: number; // 処理時間
  pages: Array<{
    pageNumber: number;
    text: string;          // ページテキスト
    confidence: number;    // 信頼度
    forms?: Array<{        // ページ毎フォーム
      key: string;
      value: string;
    }>;
    tables?: Table[];      // ページ毎テーブル
  }>;
  forms?: Array<{         // 全体フォーム（互換性維持）
    key: string;
    value: string;
  }>;
  tables?: Table[];       // 全体テーブル（互換性維持）
}
```

### テーブル構造（2D配列対応）

```typescript
interface Table {
  cells: TableCell[];     // セル配列
  rows?: string[][];      // 2D 配列形式（NEW）
}

interface TableCell {
  text: string;
  rowIndex: number;
  columnIndex: number;
}
```

## テスト結果・性能

### 実行結果例（10ページPDF）

```bash
=== OCR Test Results ===
Pages processed: 10
Forms found: 361
Tables found: 18
Processing time: ~20秒（Textract 非同期処理）

=== Table Preview ===
Table 1:
  Row 1: [ | to I | x]
  Row 2: [ |  | ]
Table 2:
  Row 1: [UNITED | ]
  Row 2: [1WF | ±0.1]
  ... and 5 more rows
```

### Lambda 制限対応

- **実行時間**: 非同期処理で15分制限回避
- **メモリ**: pdf2pic 除外によりメモリ使用量削減  
- **パッケージサイズ**: Container Image で柔軟対応
- **コスト**: Textract 非同期処理で効率化

## エラーハンドリング

### エラー種別

- `FILE_ERROR`: ファイル処理エラー
- `SIZE_LIMIT_ERROR`: ファイルサイズ制限
- `QUOTA_EXCEEDED`: 使用量制限
- `OCR_ENGINE_ERROR`: Textract エラー
- `TIMEOUT_ERROR`: タイムアウト

### リトライ戦略

- 指数バックオフ
- 最大試行回数: 3回
- タイムアウト: 900秒（Lambda制限）

## 監視・運用

### CloudWatch 統合

- **ログ**: 構造化JSON形式でログ出力
- **メトリクス**: 処理時間・エラー率・ページ数監視  
- **アラーム**: エラー率、タイムアウト監視
- **X-Ray**: 分散トレーシング（オプション）

### CloudWatch Logs フォーマット

```json
{
  "timestamp": "2025-09-14T13:15:37.379Z",
  "level": "INFO",
  "requestId": "abc123",
  "message": "Processing completed",
  "data": {
    "inputBucket": "bucket",
    "processingTimeMs": 20237
  }
}
```

## コスト最適化

- Lambda 実行時間は Textract の非同期処理によりポーリング時間に依存
- 大きなファイルは複数ページで分割処理
- 不要な機能（pdf2pic）を除去してパッケージサイズを削減
- S3 Intelligent-Tiering 使用推奨
- CloudWatch Logs 保存期間設定

## テスト・品質保証

### ユニットテスト

```bash
npm test              # Jest実行
npm run test:watch    # ウォッチモード
```

### テストファイル

| ファイル | 説明 | デプロイ |
|---------|------|---------|
| `tests/ocr-processor.test.ts` | OCR プロセッサーのユニットテスト | 開発用 |
| `tests/lambda-handler.test.ts` | Lambda ハンドラーのユニットテスト | 開発用 |

### リント・コード品質

```bash
npm run lint          # ESLint実行
npm run lint:fix      # 自動修正
npm run build         # TypeScriptコンパイル
```

## バージョン情報

- **Version**: 1.0.0
- **Node.js**: 18.x
- **TypeScript**: 5.1.6
- **AWS SDK**: v3.400.0
- **Target**: AWS Lambda Container Image
- **Architecture**: x86_64 / arm64 対応
