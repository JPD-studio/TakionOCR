# TakionOCR - AWS Lambda PDF OCR System

[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange.svg)](https://aws.amazon.com/lambda/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1.6-blue.svg)](https://www.typescriptlang.org/)
[![AWS Textract](https://img.shields.io/badge/AWS-Textract-green.svg)](https://aws.amazon.com/textract/)

AWS Lambda を使用した高性能PDF OCRシステム。図面やドキュメントからテキスト、フォーム、テーブルをページ毎に構造化抽出します。

##  プロジェクト構造

```
TakionOCR/
├── backend/                # TypeScript バックエンド
│   ├── src/               # ソースコード
│   │   ├── lambda-handler.ts          # Lambda エントリーポイント
│   │   ├── lambda-ocr-processor.ts    # S3ベースOCR処理
│   │   ├── local-s3-runner.ts         # ローカル S3 テスト
│   │   ├── types.ts                   # 型定義
│   │   └── ...                        # その他コアファイル
│   ├── tests/             # テストファイル
│   ├── dist/              # TypeScript コンパイル結果
│   ├── Dockerfile         # Lambda Container Image
│   └── package.json       # 依存関係
├── samples/               # サンプル文書
│   └── test-documents/
├── output/                # OCR結果出力
└── README.md              # 本ファイル
```

##  TypeScript ファイル構成表

| ファイル名 | 説明 | Lambda デプロイ | ローカルテスト | 現在の使用状況 | 備考 |
|-----------|------|----------------|--------------|------------|------|
| **現行メインシステム** | | | | | |
| `lambda-handler.ts` | AWS Lambda エントリーポイント（S3イベント処理） | ○ | X | ○ | 本番環境必須 |
| `lambda-ocr-processor.ts` | S3ベース非同期OCR処理（Textract統合） | ○ | ○ | ○ | メインロジック |
| **コアモジュール（現行使用中）** | | | | | |
| `types.ts` | 型定義（OcrResult, TableCell, Form等） | ○ | ○ | ○ | 全ファイルで使用 |
| `logger.ts` | 構造化ログ出力（CloudWatch連携） | ○ | ○ | ○ | 全ファイルで使用 |
| `config-manager.ts` | AWS Parameter Store設定管理 | ○ | ○ | ○ | 現行システムで使用 |
| `retry-manager.ts` | リトライロジック（AWS API障害対応） | ○ | ○ | ○ | 現行システムで使用 |
| `metrics-service.ts` | CloudWatch メトリクス収集 | ○ | X | ○ | 現行システムで使用 |
| `errors.ts` | カスタムエラー定義 | ○ | ○ | ○ | retry-manager等で使用 |
| **ローカル開発専用** | | | | | |
| `local-s3-runner.ts` | ローカルS3テスト実行（Lambda環境模擬） | X | ○ | ○ | Lambda動作確認用 |
| `local-runner.ts` | 直接ファイル処理（従来OCR使用） | X | ○ | △ | 旧システム使用 |
| **従来システム（現在未使用）** | | | | | |
| `ocr-processor.ts` | 従来型OCR処理（DetectDocumentText使用） | X | ○ | X | local-runner専用 |
| `ocr-processor-textract.ts` | 旧Textract統合処理 | X | X | X | 完全に非推奨 |
| **従来システム専用モジュール（未使用）** | | | | | |
| `file-validator.ts` | ファイル検証ロジック（高機能版） | X | X | X | ocr-processor-textract専用 |
| `file-validator-simple.ts` | シンプルファイル検証 | X | X | X | 未使用 |
| `file-validator-backup.ts` | バックアップファイル検証 | X | X | X | 未使用・削除予定 |
| `usage-manager.ts` | 使用量管理（DynamoDB連携） | X | X | X | ocr-processor-textract専用 |
| `text-filter.ts` | テキストフィルタリング処理 | X | X | X | ocr-processor-textract専用 |
| **テストファイル** | | | | | |
| `tests/lambda-handler.test.ts` | Lambda ハンドラーの単体テスト | X | ○ | ○ | 品質保証 |
| `tests/ocr-processor.test.ts` | 旧OCR処理の単体テスト | X | ○ | △ | 旧システム用 |

### 記号説明
- **○**: 必要・使用中
- **△**: オプション・部分使用
- **X**: 不要・未使用

### システム構成の詳細

#### 現行メインシステム（Lambda v3.0）
- **エントリーポイント**: `lambda-handler.ts` → `lambda-ocr-processor.ts`
- **必須依存**: `types.ts`, `logger.ts`, `config-manager.ts`, `retry-manager.ts`, `metrics-service.ts`, `errors.ts`
- **動作**: S3イベント → 非同期Textract処理 → 結果をS3に保存

#### ローカルテスト環境
- **Lambda模擬**: `local-s3-runner.ts` → 現行システムをローカルで実行
- **従来方式**: `local-runner.ts` → `ocr-processor.ts` → 旧DetectDocumentText使用

#### 廃止予定システム
- **`ocr-processor-textract.ts`**: 完全に使用されていない旧実装
- **関連モジュール**: `file-validator.ts`, `usage-manager.ts`, `text-filter.ts` など

##  主な機能

### OCR エンジン
- **AWS Textract AnalyzeDocument**: フォーム・テーブル構造認識
- **非同期処理**: S3 + StartDocumentAnalysis による大容量ファイル対応
- **ページ毎分析**: フォームとテーブルをページ単位で構造化

### テーブル抽出
- **セル情報**: `rowIndex`, `columnIndex` による位置情報
- **2D配列**: `rows[][]` 形式での表構造出力
- **ページ分離**: 各ページのテーブルを個別に管理

### 開発環境
- **ローカルテスト**: 実際の AWS サービス使用
- **LocalStack**: オフライン開発環境対応
- **TypeScript**: 型安全な開発体験

##  クイックスタート

### 1. 環境準備

```bash
# AWS CLI 設定
aws configure

# プロジェクトセットアップ
cd backend
npm install
npm run build
```

### 2. ローカルテスト

#### S3ベーステスト（推奨 - Lambda環境模擬）

実際のAWSサービスを使用してLambda環境を模擬：

```bash
# 環境設定
export AWS_PROFILE=your-profile
export AWS_DEFAULT_REGION=us-east-1

# テスト実行
npm run ocr-s3-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json" --bucket=your-test-bucket
```

#### LocalStack使用（オフライン開発）

ローカル環境でAWSサービスを模擬：

```bash
# LocalStack起動
docker run --rm -it -p 4566:4566 localstack/localstack

# テスト実行
npm run ocr-s3-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json" --localstack
```

#### 従来方式テスト（開発用）

直接ファイル処理（AWS接続不要）：

```bash
npm run ocr-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json" --engine="textract-analyze"
```

#### NPMスクリプト一覧

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

### 3. 結果確認

```json
{
  "engine": "textract-analyze",
  "pageCount": 10,
  "processingTimeMs": 20237,
  "pages": [
    {
      "pageNumber": 1,
      "text": "図面テキスト...",
      "confidence": 76.4,
      "forms": [{"key": "項目", "value": "値"}],
      "tables": [{
        "cells": [{"text": "A1", "rowIndex": 1, "columnIndex": 1}],
        "rows": [["A1", "B1"], ["A2", "B2"]]
      }]
    }
  ]
}
```

##  AWS Lambda デプロイ

### Container Image デプロイ（推奨）

```bash
# 1. Docker イメージ作成
docker build -t takion-ocr-lambda .

# 2. ECR リポジトリ作成
aws ecr create-repository --repository-name takion-ocr-lambda

# 3. ECR プッシュ
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
docker tag takion-ocr-lambda:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest

# 4. Lambda 関数作成
aws lambda create-function \
  --function-name takion-ocr-processor \
  --package-type Image \
  --code ImageUri=123456789012.dkr.ecr.us-east-1.amazonaws.com/takion-ocr-lambda:latest \
  --role arn:aws:iam::123456789012:role/lambda-textract-role \
  --timeout 900 \
  --memory-size 1024 \
  --environment Variables='{OUTPUT_BUCKET=takion-ocr-results}'
```

### S3 イベントトリガー設定

```bash
aws s3api put-bucket-notification-configuration \
  --bucket your-input-bucket \
  --notification-configuration '{
    "LambdaConfigurations": [{
      "Id": "takion-ocr-trigger",
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:takion-ocr-processor",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {"Key": {"FilterRules": [{"Name": "suffix", "Value": ".pdf"}]}}
    }]
  }'
```

##  システムアーキテクチャ

### Lambda最適化設計

#### S3ベース非同期処理
- PDFファイルをS3に配置してトリガー
- `StartDocumentAnalysis`による非同期処理（Lambda 15分制限対応）
- `GetDocumentAnalysis`でのポーリング処理
- `pdf2pic`同期処理は除外（メモリ・実行時間制限のため）

#### コンテナイメージ対応
- Lambda Container Imageによる柔軟なデプロイ
- S3イベントトリガー自動実行
- 大容量PDF処理対応
- Lambda固有のエラーハンドリング

### 処理フロー

#### 本番環境（Lambda）
1. **S3イベント受信** (`lambda-handler.ts`)
2. **ファイル取得** (`lambda-ocr-processor.ts`)
3. **Textract非同期開始** (`StartDocumentAnalysis`)
4. **結果ポーリング** (`GetDocumentAnalysis`)
5. **ページ毎構造化** (フォーム・テーブル抽出)
6. **S3結果保存** (`PutObject`)

#### ローカル開発環境
1. **ファイル読み込み** (`local-s3-runner.ts`)
2. **S3アップロード** (`PutObject`)
3. **Lambdaプロセッサ実行** (上記フローと同様)
4. **結果ダウンロード・表示**

##  環境設定

### .env ファイルの設定

ローカル開発環境では、プロジェクトルートに `.env` ファイルを作成してAWS認証情報と設定を管理します：

```bash
# AWS 認証情報
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_DEFAULT_REGION=us-east-1

# S3 設定
INPUT_BUCKET=your-input-bucket
OUTPUT_BUCKET=your-output-bucket

# Textract 設定
TEXTRACT_TIMEOUT=900
MAX_RETRY_ATTEMPTS=3

# ローカル開発用
LOCAL_S3_ENDPOINT=http://localhost:4566  # LocalStack使用時
```

**重要**: `.env` ファイルは `.gitignore` に含まれており、リポジトリにコミットされません。各開発者が個別に設定する必要があります。

### サンプル .env.example

```bash
# プロジェクトルートに .env.example として参考用設定を配置
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here
AWS_DEFAULT_REGION=us-east-1
INPUT_BUCKET=your-input-bucket-name
OUTPUT_BUCKET=your-output-bucket-name
TEXTRACT_TIMEOUT=900
MAX_RETRY_ATTEMPTS=3
```

##  設定

### 環境変数

| 変数名 | 説明 | デフォルト |
|-------|------|----------|
| `AWS_DEFAULT_REGION` | AWS リージョン | `us-east-1` |
| `OUTPUT_BUCKET` | 結果出力S3バケット | 入力バケット |
| `TEXTRACT_TIMEOUT` | Textract タイムアウト（秒） | `900` |
| `MAX_RETRY_ATTEMPTS` | リトライ最大回数 | `3` |

### IAM 権限

Lambda 実行ロールに以下のポリシーをアタッチしてください：

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

### オプション設定（SSM Parameter Store）

高度な設定管理にはAWS Systems Manager Parameter Storeを使用：

| パラメータ名 | 説明 | デフォルト |
|------------|------|-----------|
| `/config/pdf-ocr/MAX_PAGES_PER_MONTH` | 月間ページ数制限 | `1000` |
| `/config/pdf-ocr/MAX_FILE_SIZE` | ファイルサイズ制限（MB） | `100` |
| `/config/pdf-ocr/OCR_TIMEOUT` | OCRタイムアウト（秒） | `900` |

##  処理性能

### テスト結果 (10ページPDF)

| 項目 | 結果 |
|------|------|
| 処理時間 | ~20秒 |
| 抽出フォーム | 361項目 |
| 抽出テーブル | 18個 |
| 平均信頼度 | 76-93% |

### Lambda 制限対応

- **実行時間**: 非同期処理で15分制限回避
- **メモリ**: pdf2pic 除外によりメモリ使用量削減
- **パッケージサイズ**: Container Image で柔軟対応

##  開発・テスト

### ファイル分類

**本番デプロイ必須:**
- `lambda-handler.ts` - Lambda エントリーポイント
- `lambda-ocr-processor.ts` - メイン処理
- `types.ts`, `logger.ts`, `config-manager.ts`, `retry-manager.ts`, `metrics-service.ts`, `errors.ts` - コアモジュール

**ローカル開発専用:**
- `local-runner.ts` - 従来方式テスト
- `local-s3-runner.ts` - S3方式テスト
- `tests/` - ユニットテスト

**廃止予定:**
- `ocr-processor.ts` - 旧システム（DetectDocumentText）
- `ocr-processor-textract.ts` - 完全に非推奨

### 品質保証

#### ユニットテスト
```bash
npm test              # Jest実行
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジレポート
```

#### コード品質
```bash
npm run lint          # ESLint実行
npm run lint:fix      # 自動修正
npm run build         # TypeScriptコンパイル確認
```

#### テストファイル構成
| ファイル | 説明 | カバレッジ対象 |
|---------|------|--------------|
| `tests/lambda-handler.test.ts` | Lambdaハンドラー単体テスト | S3イベント処理 |
| `tests/ocr-processor.test.ts` | OCR処理単体テスト | Textract統合 |

##  監視・運用

### CloudWatch

- **ログ**: 構造化JSON形式で詳細な実行情報を記録
- **メトリクス**: 処理時間、エラー率、ページ数、信頼度スコア
- **アラーム**: エラー率、タイムアウト、メモリ使用量監視

### 構造化ログ例

```json
{
  "timestamp": "2025-09-15T13:15:37.379Z",
  "level": "INFO",
  "requestId": "abc123",
  "message": "Processing completed",
  "data": {
    "inputBucket": "bucket",
    "processingTimeMs": 20237,
    "pageCount": 10,
    "confidence": 76.4
  }
}
```

### コスト最適化

- **非同期処理**: Textract非同期処理によりLambda実行時間最小化
- **パッケージ最適化**: 不要機能（pdf2pic）除去によるサイズ削減
- **ストレージ**: S3 Intelligent-Tiering使用でコスト削減
- **ログ管理**: CloudWatch Logs保存期間設定でストレージコスト管理

### バージョン情報

- **Version**: 1.0.0
- **Node.js**: 18.x
- **TypeScript**: 5.1.6  
- **AWS SDK**: v3.400.0+
- **Architecture**: x86_64 / arm64対応

##  貢献

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

##  ライセンス

##  リポジトリ整理・不要ファイル管理

### 現在の状況

このリポジトリには開発過程で作成された多くのファイルが含まれています。本番環境で必要なのは **Lambda OCRシステム** のみのため、以下のファイル分類に基づいて整理を推奨します。

### 🗂️ ファイル分類と削除推奨度

#### **🔴 即座に削除可能（完全に不要）**

**TypeScript 廃止ファイル**
- `backend/src/ocr-processor-textract.ts` - 旧Textract実装（非推奨）
- `backend/src/file-validator.ts` - 旧システム専用検証
- `backend/src/file-validator-simple.ts` - 未使用検証ロジック
- `backend/src/file-validator-backup.ts` - バックアップファイル
- `backend/src/usage-manager.ts` - 旧システム専用使用量管理
- `backend/src/text-filter.ts` - 旧システム専用フィルタ

**開発・テスト用一時ファイル**
- `backend/production-test.ts` - 開発時のテストスクリプト
- `backend/real-integration-test.ts` - 統合テスト用
- `backend/direct-production-test.ts` - 直接テスト用
- その他 `backend/*-test.ts` - 各種テストスクリプト

**システムファイル**
- `.DS_Store` - macOS システムファイル
- `samples/.DS_Store` - macOS システムファイル

#### **🟡 要検討（プロジェクト方針による）**

**開発ドキュメント**
- `TakionOCR開発指示書v1.md` - 開発履歴として価値あり
- `TakionOCR開発指示書v2.md` - 開発履歴として価値あり
- `TakionOCR開発指示書v3.md` - 開発履歴として価値あり

**設定ファイル（重複）**
- `package.json` - ルートレベル（`backend/package.json`と重複）
- `package-lock.json` - ルートレベル（`backend/package-lock.json`と重複）
- `.env.local` - 開発用環境設定

**出力ファイル**
- `output/*.json` - OCRテスト結果（成果物として価値あり）

#### **🔵 将来拡張のため保持**

**フロントエンドディレクトリ**
```
frontend/                 # React + Vite プロジェクト
├── src/                 # 将来のWebUI実装用
├── package.json         # フロントエンド依存関係
└── ...                  # フロントエンド関連ファイル
```

**理由**: 将来的にWebベースのUI実装時に使用予定

### 🧹 推奨クリーンアップコマンド

#### **段階1: 安全な削除（即座に実行可能）**
```bash
# TypeScript 不要ファイル
rm backend/src/ocr-processor-textract.ts
rm backend/src/file-validator.ts
rm backend/src/file-validator-simple.ts
rm backend/src/file-validator-backup.ts
rm backend/src/usage-manager.ts
rm backend/src/text-filter.ts

# 開発用テストファイル
rm backend/*-test.ts

# システムファイル
find . -name ".DS_Store" -delete
```

#### **段階2: プロジェクト構成の整理**
```bash
# 開発ドキュメントのアーカイブ（任意）
mkdir -p archive/docs/
mv TakionOCR開発指示書v*.md archive/docs/

# ルートレベル重複ファイルの削除
rm package.json package-lock.json
rm .env.local
```

### 📊 削除後のリポジトリ構成

```
TakionOCR/
├── README.md                    # プロジェクトドキュメント
├── .gitignore                   # Git除外設定
├── backend/                     # Lambda OCRシステム
│   ├── src/                    # コアソースコード
│   │   ├── lambda-handler.ts          # Lambda エントリーポイント
│   │   ├── lambda-ocr-processor.ts    # メイン処理
│   │   ├── types.ts                   # 型定義
│   │   ├── logger.ts                  # ログ管理
│   │   ├── config-manager.ts          # 設定管理
│   │   ├── retry-manager.ts           # リトライロジック
│   │   ├── metrics-service.ts         # メトリクス収集
│   │   ├── errors.ts                  # エラー定義
│   │   ├── local-s3-runner.ts         # ローカルテスト
│   │   └── local-runner.ts            # 従来テスト
│   ├── tests/                  # ユニットテスト
│   ├── Dockerfile              # Container Image
│   ├── package.json            # 依存関係
│   └── README.md               # 技術詳細
├── samples/                    # サンプルドキュメント
└── frontend/                   # 将来拡張用（保持）
```

### ⚠️ 注意事項

1. **バックアップ推奨**: 削除前に`git commit`でスナップショットを作成
2. **段階的実行**: 一度にすべて削除せず、段階的に実行
3. **チーム確認**: 他の開発者がファイルを使用していないか確認

MIT License

##  サポート

