# TakionOCR - 開発指示書 v2.0（改善版）

------

## 0. プロジェクト概要

TakionOCR は、PDF ファイルを対象に複数の OCR エンジン（AWS Textract, Tesseract など）を利用してテキスト抽出を行うシステムである。

- **リポジトリは共通**であり、ローカル開発と AWS 本番デプロイの両方に対応する。
- **環境ごとにエントリーポイントと設定を切替える**方式を採用する。
- **ローカル環境:** 開発・テストを実施
- **AWS環境:** Lambda + S3 + Amplify で本番運用

### 0.1 アーキテクチャ概要

```
[フロントエンド]     [バックエンド]        [OCRエンジン]
React + Amplify  →  Lambda/Local Runner  →  Textract/Tesseract
      ↓                    ↓                      ↓
   Cognito認証         S3/ローカルFS           結果JSON出力
      ↓                    ↓
   S3アップロード      DynamoDB料金管理
```

**技術選択の根拠:**
- **Tesseract.js**: ローカル環境での無料OCR処理、ブラウザ互換性
- **DynamoDB**: 料金制限管理の高速読み書き、自動スケーリング
- **Amplify**: 静的サイトホスティング、Cognito統合の簡便性

### 0.2 初期セットアップ

1. リポジトリをクローンする。

2. **ルートディレクトリで**バックエンドの依存関係をインストールする。

   ```bash
   cd backend
   npm install
   ```

3. フロントエンドの依存関係をインストールする。

   ```bash
   cd ../frontend
   npm install
   ```

4. **必要なディレクトリを作成する。**

   ```bash
   mkdir -p output logs samples samples/mock-responses samples/test-documents
   ```

5. **環境変数ファイルを設定する。**

   ```bash
   # ルートディレクトリに .env.local を作成
   cp .env.example .env.local
   # 必要に応じて値を編集
   ```

------

## 第1章: ローカルホスト開発・テスト環境

※ 本章はローカル環境の仕様。**リポジトリは共通**であり、本番との差異は実行方法と設定のみ。

### 1.1 前提条件

- **Node.js**: 18.18.0 以上（LTS推奨、具体的には18.18.0, 20.9.0以降）
- **TypeScript**: 4.9.5 以上
- **ローカル用エントリーポイント**: `backend/src/local-runner.ts` を利用する。
- **AWS認証情報の設定（Textract使用時のみ）:**
  - AWS CLI設定済み（`aws configure`）、または
  - 環境変数 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` が設定済み、または
  - EC2/ECS等でIAMロールを利用
- **Tesseract言語データ:** `tesseract.js` が自動でダウンロードするため事前インストール不要
- **環境変数管理**: リポジトリルートの `.env.local` ファイルで管理する。

### 1.2 環境変数設定

**`.env.local` の例:**

```bash
# 共通設定
LOG_LEVEL=debug
NODE_ENV=development

# モックデータ使用（Textract料金節約用）
USE_MOCK_DATA=false

# AWS設定（Textract使用時）
AWS_REGION=us-east-1
# ローカル環境での月間制限（テスト用に低く設定）
TEXTRACT_MAX_PAGES_PER_MONTH=50

# Tesseract設定
TESSERACT_LANGUAGE=jpn+eng

# タイムアウト設定（秒）
OCR_TIMEOUT_SECONDS=300
FILE_UPLOAD_TIMEOUT_SECONDS=30

# リトライ設定
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000
```

### 1.3 実行方法

**`backend/package.json` の `scripts` の例:**

```json
{
  "scripts": {
    "build": "tsc",
    "ocr-local": "ts-node src/local-runner.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "dev": "nodemon --exec ts-node src/local-runner.ts",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix"
  }
}
```

**実行コマンド例:**

```bash
cd backend

# Tesseract を利用する場合
npm run ocr-local -- --file ../samples/document.pdf --engine tesseract

# AWS Textract を利用する場合  
npm run ocr-local -- --file ../samples/document.pdf --engine textract

# 出力先を指定する場合
npm run ocr-local -- --file ../samples/document.pdf --engine tesseract --output ../custom-output/

# バッチ処理（複数ファイル）
npm run ocr-local -- --batch ../samples/ --engine tesseract

# ヘルプ表示
npm run ocr-local -- --help
```

### 1.4 処理フロー

1. **入力検証**: コマンドライン引数で指定されたファイルの存在・形式・サイズを検証する。
2. **セキュリティチェック**: PDFファイルの悪意あるコンテンツ検証（ファイルヘッダー確認）。
3. **前処理**: ファイル形式（PDF）を検証し、ページ数を取得する。
4. **OCR実行**: 指定されたエンジンでOCRを実行する（タイムアウト・リトライ機能付き）。
5. **結果保存**: 結果を指定ディレクトリ（デフォルト: `./output/`）にJSON形式で保存する。
6. **ログ出力**: ログを `./logs/` ディレクトリとコンソールに出力する。
7. **エラー処理**: エラー発生時は `./output/[timestamp]-error.json` にエラー詳細を保存する。
8. **クリーンアップ**: 一時ファイルの確実な削除を実行する。

### 1.5 エラーハンドリング戦略

**リトライロジック:**
- **対象**: ネットワークエラー、一時的なAPI障害
- **回数**: 最大3回（環境変数で設定可能）
- **間隔**: 指数バックオフ（1秒、2秒、4秒）

**タイムアウト処理:**
- **ファイルアップロード**: 30秒
- **OCR処理**: 300秒（5分）
- **API呼び出し**: 60秒

**部分失敗処理:**
- **複数ページPDF**: 一部ページ失敗時も成功ページの結果を保存
- **バッチ処理**: 一部ファイル失敗時も他ファイルの処理を継続

### 1.6 ローカル限定仕様

- **ストレージ**: ローカルファイルシステムを利用する。

  - 入力: `./samples/` （または任意のパス）
  - 出力: `./output/` （または `--output` オプション指定先）
  - ログ: `./logs/`
  - 一時ファイル: `./temp/` （処理後自動削除）

- **料金制限対応**: AWS Textract の呼び出しを抑制するため、モックモードを実装する。

  - 有効化: `.env.local` に `USE_MOCK_DATA=true` を設定する。
  - モック時は `./samples/mock-responses/` から事前定義されたレスポンスを返す。

- **フロントエンド開発サーバー**:

  ```bash
  # frontend/ ディレクトリで実行
  npm run dev
  # http://localhost:3000 でアクセス可能
  ```

------

## 第2章: AWS Lambda デプロイ環境

※ 本章は本番環境の仕様。リポジトリは共通であり、設定とエントリーポイントが異なる。

### 2.1 前提条件

- **AWSサービス構成:**
  - Lambda Function（Node.js 18.x ランタイム）
  - S3 Bucket（入力用・出力用）
  - CloudWatch Logs（ログ記録）
  - DynamoDB Table（料金制限カウンタ）
  - Systems Manager Parameter Store（設定管理）
  - SQS Dead Letter Queue（エラー処理）
  - CloudWatch Alarms（監視・アラート）
- **Amplify Hosting:** フロントエンド用（Cognito認証付き）
- **IAM権限:** Lambda実行ロールに以下権限が必要:
  - `textract:DetectDocumentText`, `textract:AnalyzeDocument`
  - `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`
  - `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`
  - `ssm:GetParameter`, `ssm:GetParameters`
  - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`
  - `sqs:SendMessage`（DLQ用）

### 2.2 AWS環境変数・パラメータ設定

**Lambda環境変数:**

```bash
NODE_ENV=production
S3_INPUT_BUCKET=takion-ocr-input-bucket
S3_OUTPUT_BUCKET=takion-ocr-output-bucket
DYNAMODB_USAGE_TABLE=TakionOcrUsage
DLQ_URL=https://sqs.us-east-1.amazonaws.com/123456789012/takion-ocr-dlq
```

**Parameter Store設定:**

```bash
# 機能制御
/config/pdf-ocr/textract-enabled = "true"
/config/pdf-ocr/tesseract-enabled = "true"

# 制限設定（本番環境では高めに設定）
/config/pdf-ocr/max-pages-per-month = "1000"  
/config/pdf-ocr/max-file-size-mb = "10"
/config/pdf-ocr/max-pages-per-file = "50"

# アラート設定
/config/pdf-ocr/alert-threshold = "0.8"
/config/pdf-ocr/admin-email = "admin@example.com"

# タイムアウト・リトライ設定
/config/pdf-ocr/ocr-timeout-seconds = "300"
/config/pdf-ocr/max-retry-attempts = "3"
```

### 2.3 処理フロー

1. **トリガー**: ユーザーがフロントエンドからS3の `input/` プレフィックスにPDFをアップロードする。
2. **Lambda起動**: S3イベント（`s3:ObjectCreated:*`）がLambda関数をトリガーする。
3. **設定取得**: Parameter Storeから設定値を取得する。
4. **料金制限チェック**: DynamoDBで月間使用量をチェックする。
5. **入力検証**: ファイルサイズ・形式・セキュリティチェックを実行する。
6. **OCR実行**: 制限内であればOCRを実行する（リトライ・タイムアウト機能付き）。
7. **使用量更新**: DynamoDBの使用量を更新する。
8. **結果保存**: 結果をS3の `results/[user-id]/[original-filename]/[timestamp]-result.json` に保存する。
9. **通知**: 処理完了をフロントエンドに通知する（WebSocket/Polling）。
10. **処理失敗時:**
    - CloudWatch Logsにエラー詳細を記録
    - SQSのDead Letter Queueにメッセージを送信
    - S3の `errors/[user-id]/` プレフィックスにエラー情報を保存
    - 管理者にアラート通知

### 2.4 料金制限ロジック（改善版）

**DynamoDB テーブル構造:**

```json
{
  "PK": "USAGE#2025#09",  // 年月をキーとする
  "SK": "TOTAL",          // ソートキー（将来のユーザー別制限に対応）
  "totalPages": 234,      // 処理済みページ数
  "totalFiles": 45,       // 処理済みファイル数
  "lastUpdated": "2025-09-07T12:34:56Z",
  "monthlyLimit": 1000,   // 月間制限値
  "alertThreshold": 800,  // アラート閾値（80%）
  "TTL": 1672531200       // 自動削除用（3ヶ月後）
}
```

**制限チェックロジック:**

1. 現在の年月でDynamoDBから使用量を取得
2. `totalPages + 予定処理ページ数 > monthlyLimit` の場合、処理を中断
3. アラート閾値（80%）到達時、管理者に通知
4. 処理後、使用量を原子的に更新（条件付き更新）

### 2.5 緊急停止・制御機能

**Parameter Store値による制御:**

- **完全停止**: `/config/pdf-ocr/textract-enabled` = `"false"`
- **部分停止**: `/config/pdf-ocr/tesseract-enabled` = `"false"`
- **制限変更**: `/config/pdf-ocr/max-pages-per-month` の値を動的変更
- **即座反映**: Lambda関数は実行時に毎回この値をチェック

**手動制御コマンド:**

```bash
# 緊急停止
aws ssm put-parameter --name "/config/pdf-ocr/textract-enabled" --value "false" --overwrite

# 制限値変更
aws ssm put-parameter --name "/config/pdf-ocr/max-pages-per-month" --value "500" --overwrite
```

------

## 第3章: 共通技術仕様

※ ローカル/本番環境で共通の仕様。

### 3.1 対応ファイル形式

- **入力形式:** PDF のみ
- **最大ファイルサイズ:** 10MB （Lambda制限考慮）
- **最大ページ数:** 50ページ/ファイル （処理時間制限考慮）
- **月間処理制限:**
  - ローカル環境: 50ページ/月（テスト用）
  - AWS環境: 1000ページ/月（本番用）

### 3.2 OCRエンジン仕様

**Textract:**

- **精度:** 高精度（印刷文字: 99%+、手書き文字: 85%+、表組み: 95%+）
- **コスト:** $0.0015/ページ（2025年現在）
- **制限:** 最大3000ページ/分
- **言語:** 英語、日本語など多言語対応
- **特徴:** 表構造認識、フォーム認識

**Tesseract:**

- **精度:** 中程度（印刷文字: 90%+、手書き文字: 60%+）
- **コスト:** 無料
- **制限:** 処理時間がファイルサイズに比例（1ページ約10-30秒）
- **言語:** 設定可能（デフォルト: 日本語+英語）
- **特徴:** オープンソース、カスタマイズ可能

### 3.3 JSON出力形式（改善版）

**成功時の出力:**

```json
{
  "version": "2.0",
  "engine": "textract",
  "inputFile": "document.pdf", 
  "fileSize": 2048000,
  "pageCount": 3,
  "processingTimeMs": 5420,
  "timestamp": "2025-09-07T12:34:56.789Z",
  "userId": "user123",
  "requestId": "req-12345-abcde",
  "pages": [
    { 
      "pageNumber": 1, 
      "text": "抽出されたテキスト内容...",
      "confidence": 0.95,
      "blockCount": 12,
      "processingTimeMs": 1800,
      "language": "ja"
    },
    { 
      "pageNumber": 2, 
      "text": "2ページ目のテキスト...",
      "confidence": 0.98,
      "blockCount": 8,
      "processingTimeMs": 2100,
      "language": "ja"
    }
  ],
  "summary": {
    "totalCharacters": 1250,
    "averageConfidence": 0.965,
    "detectedLanguages": ["ja", "en"],
    "processingMode": "standard"
  },
  "metadata": {
    "region": "us-east-1",
    "instanceId": "lambda-instance-123",
    "retryCount": 0
  }
}
```

**エラー時の出力:**

```json
{
  "version": "2.0",
  "error": true,
  "errorType": "PROCESSING_ERROR",
  "errorCode": "OCR_ENGINE_FAILURE",
  "errorMessage": "Failed to extract text from page 2",
  "inputFile": "document.pdf",
  "engine": "textract", 
  "timestamp": "2025-09-07T12:34:56.789Z",
  "userId": "user123",
  "requestId": "req-12345-abcde",
  "partialResults": {
    "successfulPages": [1],
    "failedPages": [2, 3],
    "partialData": "1ページ目の抽出結果..."
  },
  "errorDetails": {
    "stack": "Error stack trace...",
    "retryCount": 3,
    "lastRetryAt": "2025-09-07T12:34:50.123Z",
    "awsRequestId": "aws-req-67890"
  },
  "recovery": {
    "canRetry": false,
    "suggestedAction": "Contact support with requestId"
  }
}
```

### 3.4 エラーハンドリング分類（拡張版）

**エラータイプ定義:**

- `FILE_ERROR`: ファイル読み込み/形式エラー
- `SIZE_LIMIT_ERROR`: ファイルサイズ超過
- `PAGE_LIMIT_ERROR`: ページ数制限超過
- `QUOTA_EXCEEDED`: 料金制限による処理停止
- `OCR_ENGINE_ERROR`: OCRエンジン自体のエラー
- `NETWORK_ERROR`: AWS API呼び出し失敗
- `TIMEOUT_ERROR`: 処理タイムアウト
- `CONFIGURATION_ERROR`: 設定値の問題
- `SECURITY_ERROR`: セキュリティチェック失敗
- `PARTIAL_FAILURE`: 部分的な処理失敗

**エラー対応フロー:**

```
エラー発生 → 分類 → リトライ判定 → 実行 or 失敗処理
                ↓
            ログ記録 → DLQ送信 → 管理者通知
```

### 3.5 ログ仕様（構造化ログ）

**ログレベル:**

- `DEBUG`: 詳細な処理情報
- `INFO`: 処理開始/完了の要約
- `WARN`: 警告（制限に近づいている等）
- `ERROR`: エラー情報
- `FATAL`: システム停止レベルのエラー

**ログ形式（JSON構造化）:**

```json
{
  "timestamp": "2025-09-07T12:34:56.789Z",
  "level": "INFO",
  "service": "takion-ocr",
  "version": "2.0",
  "requestId": "req-12345",
  "userId": "user123",
  "message": "OCR processing completed",
  "data": {
    "engine": "textract",
    "pageCount": 3,
    "processingTimeMs": 5420,
    "fileSize": 2048000
  },
  "environment": "production"
}
```

**ログ出力先:**

- ローカル: `./logs/app-[YYYY-MM-DD].log`
- AWS: CloudWatch Logs（ロググループ: `/aws/lambda/takion-ocr`）

### 3.6 主要な依存ライブラリ（バージョン固定）

| 領域               | ライブラリ                 | バージョン | 目的                        | 選択理由 |
| ------------------ | -------------------------- | ---------- | --------------------------- | -------- |
| **バックエンド**   | `typescript`               | 4.9.5      | TypeScript開発              | 安定版、Lambda対応 |
|                    | `ts-node`                  | 10.9.1     | TypeScriptコードを直接実行  | 開発効率 |
|                    | `@aws-sdk/client-textract` | 3.400.0    | AWS Textract API 連携       | 公式SDK |
|                    | `@aws-sdk/client-s3`       | 3.400.0    | S3操作                      | 公式SDK |
|                    | `@aws-sdk/client-dynamodb` | 3.400.0    | DynamoDB操作                | 公式SDK |
|                    | `tesseract.js`             | 4.1.1      | Tesseract OCR エンジン      | ブラウザ互換 |
|                    | `yargs`                    | 17.7.2     | コマンドライン引数の解析    | 豊富な機能 |
|                    | `winston`                  | 3.10.0     | ログ管理                    | 構造化ログ対応 |
|                    | `pdf-parse`                | 1.1.1      | PDF解析・ページ数取得       | 軽量 |
|                    | `joi`                      | 17.9.2     | 入力検証                    | スキーマ検証 |
| **フロントエンド** | `react`                    | 18.2.0     | UI構築                      | 最新安定版 |
|                    | `@aws-amplify/ui-react`    | 5.0.5      | Amplify連携UIコンポーネント | 公式UI |
|                    | `@aws-amplify/storage`     | 5.0.5      | S3ファイルアップロード      | 公式ストレージ |

------

## 第4章: フロントエンド仕様

### 4.1 技術スタック

- **フレームワーク**: React 18.2.0 + TypeScript 4.9.5
- **UIライブラリ**: AWS Amplify UI React 5.0.5
- **状態管理**: React Hooks（useState, useContext, useReducer）
- **認証**: Amazon Cognito User Pool
- **ファイルアップロード**: Amplify Storage (S3)
- **リアルタイム通信**: WebSocket（処理状況更新用）

### 4.2 実行環境

**ローカル開発:**

```bash
cd frontend
npm run dev
# http://localhost:3000 でアクセス
```

**本番環境:**

- Amplify Hosting を利用
- GitHub連携による自動デプロイ
- 独自ドメイン対応可能
- CDN配信（CloudFront）

### 4.3 主要画面仕様（詳細版）

**1. ファイルアップロード画面:**

- PDFファイルのドラッグ&ドロップ対応
- ファイルサイズ制限表示（10MB）
- ページ数制限表示（50ページ）
- OCRエンジン選択（Textract/Tesseract）
- アップロード進捗表示（プログレスバー）
- 複数ファイル同時アップロード対応
- ファイル形式検証（クライアントサイド）

**2. 処理状況確認画面:**

- 処理中ファイル一覧（リアルタイム更新）
- 進捗状況の詳細表示（ページ別進捗）
- 処理キャンセル機能
- エラー発生時の詳細表示
- 処理履歴表示（過去30日分）
- 使用量表示（月間制限に対する現在の使用状況）

**3. 結果表示画面:**

- 抽出テキストの表示・編集
- ページ別表示切り替え
- テキストのコピー・ダウンロード機能（TXT/JSON形式）
- 信頼度スコア表示（Textractの場合）
- 検索・ハイライト機能
- 結果の保存・共有機能

**4. 設定・管理画面:**

- ユーザープロファイル管理
- 使用量統計表示
- 処理履歴管理
- エクスポート設定

### 4.4 認証フロー（詳細版）

1. **サインアップ**: ユーザーはCognitoユーザープールでアカウント作成
2. **メール認証**: 確認コードによるメール認証
3. **サインイン**: JWT トークンを取得してS3アクセス権限を獲得
4. **権限確認**: 認証済みユーザーのみファイルアップロード可能
5. **データ分離**: ユーザー別のS3プレフィックスでファイル分離（`users/{userId}/`）
6. **セッション管理**: トークンの自動更新、ログアウト処理

### 4.5 ユーザビリティ機能

**進捗表示:**
- リアルタイム進捗更新（WebSocket接続）
- 処理時間の予測表示
- 詳細ステータス（「ページ2/5を処理中...」）

**エラー処理:**
- ユーザーフレンドリーなエラーメッセージ
- 復旧手順の提示
- サポート連絡先の表示

**アクセシビリティ:**
- キーボードナビゲーション対応
- スクリーンリーダー対応
- 高コントラストモード対応

------

## 第5章: 開発・デプロイ要件

### 5.1 ローカル開発環境

**必須ツール:**

- Node.js 18.18.0 以上（推奨: 18.18.0, 20.9.0）
- npm 9.0.0 以上 または yarn 1.22.0 以上
- AWS CLI 2.0 以上（Textract使用時）
- Git 2.30 以上
- Docker 20.10 以上（オプション、コンテナ開発用）

**開発フロー:**

1. **環境構築**: `npm install` で依存関係インストール
2. **機能開発**: `npm run dev` でホットリロード開発
3. **コード品質**: `npm run lint` でESLint実行
4. **ユニットテスト**: `npm run test` でJest実行
5. **統合テスト**: `npm run ocr-local` で実際のファイル処理テスト
6. **ビルドテスト**: `npm run build` でTypeScriptコンパイル確認
7. **E2Eテスト**: `npm run test:e2e` でPlaywright実行（オプション）

### 5.2 CI/CDパイプライン

**GitHub Actions ワークフロー:**

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18.18.0'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Staging
        run: |
          sam build
          sam deploy --config-env staging

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Production
        run: |
          sam build
          sam deploy --config-env production
```

### 5.3 AWSデプロイメント

**1. フロントエンド（Amplify）:**

```yaml
# amplify.yml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend && npm ci
        - npm run lint
    build:
      commands:
        - npm run build
        - npm run test:unit
  artifacts:
    baseDirectory: frontend/build
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

**2. バックエンド（AWS SAM）:**

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Parameters:
  Environment:
    Type: String
    Default: development
    AllowedValues: [development, staging, production]

Globals:
  Function:
    Runtime: nodejs18.x
    Timeout: 300
    MemorySize: 1024
    Environment:
      Variables:
        NODE_ENV: !Ref Environment

Resources:
  # Lambda Function
  TakionOcrFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: backend/
      Handler: src/lambda-handler.handler
      Environment:
        Variables:
          S3_INPUT_BUCKET: !Ref InputBucket
          S3_OUTPUT_BUCKET: !Ref OutputBucket
          DYNAMODB_USAGE_TABLE: !Ref UsageTable
          DLQ_URL: !Ref DeadLetterQueue
      Events:
        S3Event:
          Type: S3
          Properties:
            Bucket: !Ref InputBucket
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: input/
                  - Name: suffix  
                    Value: .pdf
      DeadLetterQueue:
        Type: SQS
        TargetArn: !GetAtt DeadLetterQueue.Arn

  # S3 Buckets
  InputBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'takion-ocr-input-${Environment}'
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

  OutputBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'takion-ocr-output-${Environment}'
      VersioningConfiguration:
        Status: Enabled

  # DynamoDB Table
  UsageTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub 'TakionOcrUsage-${Environment}'
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: PK
          AttributeType: S
        - AttributeName: SK
          AttributeType: S
      KeySchema:
        - AttributeName: PK
          KeyType: HASH
        - AttributeName: SK
          KeyType: RANGE
      TimeToLiveSpecification:
        AttributeName: TTL
        Enabled: true

  # SQS Dead Letter Queue
  DeadLetterQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub 'takion-ocr-dlq-${Environment}'
      MessageRetentionPeriod: 1209600  # 14 days

  # CloudWatch Alarms
  ErrorRateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub 'TakionOCR-ErrorRate-${Environment}'
      AlarmDescription: 'Lambda function error rate is too high'
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 2
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref TakionOcrFunction

Outputs:
  ApiEndpoint:
    Description: 'API Gateway endpoint URL'
    Value: !Sub 'https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/'
  
  InputBucketName:
    Description: 'S3 Input Bucket Name'
    Value: !Ref InputBucket
    
  OutputBucketName:
    Description: 'S3 Output Bucket Name'
    Value: !Ref OutputBucket
```

**デプロイコマンド:**

```bash
# 環境別デプロイ
cd backend

# 開発環境
sam build
sam deploy --config-env development

# ステージング環境
sam deploy --config-env staging

# 本番環境
sam deploy --config-env production --guided

# Amplifyデプロイ（GitHubプッシュで自動実行）
git push origin main
```

### 5.4 環境別設定管理

**設定ファイル構造:**

```
config/
├── samconfig.toml          # SAM設定
├── .env.development        # 開発環境
├── .env.staging           # ステージング環境
├── .env.production        # 本番環境
└── .env.local             # ローカル環境（Git管理外）
```

**環境変数管理:**

- **ローカル環境**: `.env.local` ファイルで管理（Git管理外）
- **AWS環境**: Lambda環境変数 + Parameter Store の組み合わせ
- **機密情報**: Parameter Store（SecureString）で管理
- **設定の階層**: 環境変数 > Parameter Store > デフォルト値

------

## 第6章: フォルダ構造（詳細版）

```plaintext
takion-ocr/
├─ backend/
│   ├─ src/
│   │  ├─ services/
│   │  │  ├─ ocrService.ts       # OCR共通処理・エンジン抽象化
│   │  │  ├─ textractService.ts  # Textract固有処理  
│   │  │  ├─ tesseractService.ts # Tesseract固有処理
│   │  │  ├─ s3Service.ts        # S3操作（AWS環境用）
│   │  │  ├─ usageService.ts     # 料金制限ロジック
│   │  │  ├─ configService.ts    # 設定管理（Parameter Store）
│   │  │  ├─ notificationService.ts # 通知・アラート機能
│   │  │  └─ securityService.ts  # セキュリティチェック
│   │  ├─ utils/
│   │  │  ├─ logger.ts           # 構造化ログ管理
│   │  │  ├─ validators.ts       # 入力検証（Joi使用）
│   │  │  ├─ errorHandler.ts     # エラーハンドリング・分類
│   │  │  ├─ retryHandler.ts     # リトライロジック
│   │  │  ├─ timeoutHandler.ts   # タイムアウト処理
│   │  │  └─ fileUtils.ts        # ファイル操作ユーティリティ
│   │  ├─ types/
│   │  │  ├─ index.ts            # 共通型定義
│   │  │  ├─ ocr.ts              # OCR関連型定義
│   │  │  ├─ aws.ts              # AWS関連型定義
│   │  │  └─ api.ts              # API関連型定義
│   │  ├─ config/
│   │  │  ├─ constants.ts        # 定数定義
│   │  │  ├─ environments.ts     # 環境別設定
│   │  │  └─ validation.ts       # バリデーションスキーマ
│   │  ├─ local-runner.ts        # ローカル専用エントリーポイント
│   │  └─ lambda-handler.ts      # Lambda専用ハンドラ
│   ├─ tests/                    # テストファイル
│   │  ├─ unit/                  # ユニットテスト
│   │  ├─ integration/           # 統合テスト
│   │  ├─ fixtures/              # テストデータ
│   │  └─ __mocks__/             # モックファイル
│   ├─ package.json
│   ├─ tsconfig.json
│   ├─ jest.config.js            # Jest設定
│   ├─ .eslintrc.js              # ESLint設定
│   └─ template.yaml             # SAM設定ファイル
├─ frontend/
│   ├─ src/
│   │  ├─ components/           # React コンポーネント
│   │  │  ├─ common/            # 共通コンポーネント
│   │  │  ├─ upload/            # アップロード関連
│   │  │  ├─ processing/        # 処理状況表示
│   │  │  └─ results/           # 結果表示
│   │  ├─ hooks/                # カスタムフック
│   │  │  ├─ useAuth.ts         # 認証フック
│   │  │  ├─ useUpload.ts       # アップロードフック
│   │  │  └─ useWebSocket.ts    # WebSocketフック
│   │  ├─ services/             # API呼び出し
│   │  │  ├─ api.ts             # API クライアント
│   │  │  ├─ auth.ts            # 認証サービス
│   │  │  └─ storage.ts         # ストレージサービス
│   │  ├─ types/                # TypeScript型定義
│   │  ├─ utils/                # ユーティリティ関数
│   │  ├─ contexts/             # React Context
│   │  └─ constants/            # 定数定義
│   ├─ public/
│   ├─ package.json
│   ├─ tsconfig.json
│   ├─ .eslintrc.js
│   └─ amplify.yml              # Amplify設定ファイル
├─ config/                      # 環境設定ファイル
│   ├─ samconfig.toml           # SAM設定
│   ├─ .env.development
│   ├─ .env.staging
│   └─ .env.production
├─ output/                      # ローカル実行時の出力先
├─ logs/                        # ローカル実行時のログ
├─ temp/                        # 一時ファイル（自動削除）
├─ samples/                     # テスト用PDFファイル
│   ├─ mock-responses/          # モックレスポンス用
│   └─ test-documents/          # テスト用PDF
├─ docs/                        # 追加ドキュメント
│   ├─ api/                     # API仕様書
│   ├─ architecture/            # アーキテクチャ図
│   └─ deployment/              # デプロイ手順
├─ scripts/                     # 運用スクリプト
│   ├─ deploy.sh                # デプロイスクリプト
│   ├─ backup.sh                # バックアップスクリプト
│   └─ monitoring.sh            # 監視スクリプト
├─ .github/                     # GitHub Actions
│   └─ workflows/
│       ├─ ci-cd.yml            # CI/CDパイプライン
│       └─ security-scan.yml    # セキュリティスキャン
├─ .env.example                 # 環境変数テンプレート  
├─ .env.local                   # ローカル用環境変数（Git管理外）
├─ .gitignore
├─ README.md
├─ CHANGELOG.md                 # 変更履歴
├─ CONTRIBUTING.md              # 貢献ガイドライン
├─ LICENSE                      # ライセンス
└─ TakionOCR開発指示書v2.md     # 本ドキュメント
```

------

## 第7章: テスト要件（拡張版）

### 7.1 テスト戦略

**テストピラミッド:**
- **ユニットテスト**: 70% （高速、多数）
- **統合テスト**: 20% （中速、中数）
- **E2Eテスト**: 10% （低速、少数）

### 7.2 ユニットテスト

**対象:** 各サービスクラスの個別メソッド

**ツール:** Jest 29.0+ + TypeScript

**カバレッジ目標:**
- **ライン**: 90%以上
- **ブランチ**: 85%以上
- **関数**: 95%以上

**実行方法:**

```bash
cd backend
npm run test              # 全テスト実行
npm run test:watch        # ウォッチモード
npm run test:coverage     # カバレッジレポート生成
npm run test:unit         # ユニットテストのみ
```

**テストケース例:**

```typescript
// tests/unit/services/ocrService.test.ts
describe('OCRService', () => {
  describe('processFile', () => {
    it('should process PDF file successfully', async () => {
      // テストケース実装
    });
    
    it('should handle file size limit error', async () => {
      // エラーケーステスト
    });
    
    it('should retry on temporary failure', async () => {
      // リトライロジックテスト
    });
  });
});
```

### 7.3 統合テスト

**対象:** OCRエンジン呼び出しを含む全体フロー

**テストケース:**

**正常系:**
- Textractでのテキスト抽出
- Tesseractでのテキスト抽出
- 複数ページPDFの処理
- バッチ処理

**異常系:**
- ファイルサイズ超過
- 不正形式ファイル
- ネットワークエラー
- タイムアウト

**制限系:**
- 料金制限による処理停止
- 同時実行制限
- API制限

**実行方法:**

```bash
npm run test:integration
npm run test:integration:textract  # Textract統合テスト
npm run test:integration:tesseract # Tesseract統合テスト
```

### 7.4 E2Eテスト

**対象:** フロントエンドから結果表示までの全フロー

**ツール:** Playwright 1.30+

**テストシナリオ:**
1. ユーザー認証フロー
2. ファイルアップロード
3. 処理状況確認
4. 結果表示・ダウンロード
5. エラーハンドリング

**実行環境:** ステージング環境推奨

**実行方法:**

```bash
cd frontend
npm run test:e2e
npm run test:e2e:headed    # ブラウザ表示あり
npm run test:e2e:debug     # デバッグモード
```

### 7.5 パフォーマンステスト

**対象:** 処理時間・スループット・リソース使用量

**ツール:** Artillery.js, AWS X-Ray

**テストケース:**
- 単一ファイル処理時間
- 同時処理性能
- メモリ使用量
- API応答時間

**実行方法:**

```bash
npm run test:performance
npm run test:load         # 負荷テスト
```

------

## 第8章: 監視・運用（拡張版）

### 8.1 監視戦略

**監視レベル:**
1. **インフラ監視**: AWS リソースの稼働状況
2. **アプリケーション監視**: 処理性能・エラー率
3. **ビジネス監視**: 使用量・コスト・ユーザー行動

### 8.2 メトリクス監視

**CloudWatch メトリクス:**

**Lambda関数:**
- 実行回数、エラー率、実行時間
- メモリ使用量、タイムアウト発生数
- コールドスタート回数

**S3:**
- アップロード数、ダウンロード数
- ストレージ使用量、リクエスト数

**DynamoDB:**
- 読み書き回数、スロットリング発生数
- 消費キャパシティ、レスポンス時間

**カスタムメトリクス:**
- OCR処理成功率（エンジン別）
- 平均処理時間（ページ数別）
- 料金制限到達率

### 8.3 アラート設定（詳細版）

**料金アラート:**

```yaml
# CloudWatch Alarm設定例
UsageAlert80Percent:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: 'TakionOCR-Usage-80Percent'
    AlarmDescription: '月間処理ページ数が上限の80%に達しました'
    MetricName: 'MonthlyPageCount'
    Namespace: 'TakionOCR'
    Statistic: Maximum
    Period: 3600
    EvaluationPeriods: 1
    Threshold: 800  # 1000ページの80%
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref SNSTopicArn
```

**エラーアラート:**
- Lambda関数のエラー率が5%を超えた場合
- DLQにメッセージが蓄積された場合（10件以上）
- API応答時間が30秒を超えた場合
- ファイルアップロード失敗率が10%を超えた場合

**パフォーマンスアラート:**
- 平均処理時間が目標値の150%を超えた場合
- メモリ使用率が90%を超えた場合
- 同時実行数が上限の80%に達した場合

### 8.4 ログ分析・ダッシュボード

**CloudWatch Dashboard:**

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", "FunctionName", "TakionOcrFunction"],
          [".", "Errors", ".", "."],
          [".", "Duration", ".", "."]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Lambda Performance"
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/lambda/takion-ocr'\n| fields @timestamp, level, message, data.processingTimeMs\n| filter level = \"ERROR\"\n| sort @timestamp desc\n| limit 100",
        "region": "us-east-1",
        "title": "Recent Errors"
      }
    }
  ]
}
```

**重要ログ項目:**
- 処理時間の推移（トレンド分析）
- エンジン別の成功率（品質監視）
- ファイルサイズ分布（使用パターン分析）
- エラー原因の分類（改善点特定）
- ユーザー別使用量（課金・制限管理）

### 8.5 運用手順書

**日次運用:**
1. ダッシュボード確認（エラー率、処理時間）
2. 使用量チェック（月間制限に対する進捗）
3. ログ確認（異常なエラーパターンの検出）

**週次運用:**
1. パフォーマンストレンド分析
2. コスト分析・予算確認
3. セキュリティログ監査

**月次運用:**
1. 使用量レポート作成
2. パフォーマンス改善計画策定
3. 料金制限値の見直し

**障害対応手順:**
1. **検知**: CloudWatchアラーム、ユーザー報告
2. **初期対応**: 影響範囲確認、緊急停止判断
3. **調査**: ログ分析、メトリクス確認
4. **復旧**: 修正適用、動作確認
5. **事後対応**: 根本原因分析、再発防止策

------

## 第9章: セキュリティ要件（拡張版）

### 9.1 認証・認可（詳細版）

**多層認証:**
- **フロントエンド**: Cognito User Pool による認証
- **API**: JWT トークン検証 + 署名検証
- **S3アクセス**: ユーザー別IAMポリシーで制限
- **管理機能**: MFA必須、管理者ロール分離

**IAMポリシー例:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::takion-ocr-input/users/${cognito-identity.amazonaws.com:sub}/*",
        "arn:aws:s3:::takion-ocr-output/users/${cognito-identity.amazonaws.com:sub}/*"
      ]
    }
  ]
}
```

### 9.2 データ保護（拡張版）

**転送時暗号化:**
- **HTTPS/TLS 1.2以上**: 全通信で強制
- **S3転送**: SSL/TLS暗号化必須
- **API通信**: 証明書ピニング実装

**保存時暗号化:**
- **S3バケット**: AES-256暗号化有効化
- **DynamoDB**: 保存時暗号化有効化
- **CloudWatch Logs**: 暗号化有効化
- **Parameter Store**: SecureString使用

**データライフサイクル:**
- **一時ファイル**: Lambda実行後の確実な削除
- **処理結果**: 90日後自動削除（S3ライフサイクル）
- **ログデータ**: 1年後自動削除
- **個人情報**: GDPR準拠の削除機能

### 9.3 入力検証・セキュリティチェック

**ファイル検証:**

```typescript
// セキュリティチェック例
export class SecurityService {
  validatePdfFile(buffer: Buffer): ValidationResult {
    // PDFヘッダー検証
    if (!buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new SecurityError('Invalid PDF header');
    }
    
    // ファイルサイズ検証
    if (buffer.length > MAX_FILE_SIZE) {
      throw new SecurityError('File size exceeds limit');
    }
    
    // 悪意あるコンテンツ検証
    if (this.containsMaliciousContent(buffer)) {
      throw new SecurityError('Malicious content detected');
    }
    
    return { valid: true };
  }
}
```

**入力サニタイゼーション:**
- ファイル名の特殊文字除去
- パス・トラバーサル攻撃防止
- SQLインジェクション対策（DynamoDB）
- XSS対策（フロントエンド）

### 9.4 アクセス制御・監査

**ネットワークセキュリティ:**
- **VPC設定**: Lambda関数のVPC配置（オプション）
- **セキュリティグループ**: 最小権限の原則
- **NACLs**: ネットワークレベルでの制御

**監査ログ:**
- **CloudTrail**: 全APIコール記録
- **VPC Flow Logs**: ネットワーク通信記録
- **アプリケーションログ**: ユーザー操作記録

**セキュリティ監視:**

```yaml
# セキュリティアラート例
SecurityAlert:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: 'TakionOCR-SecurityAlert'
    AlarmDescription: '異常なアクセスパターンを検知'
    MetricName: 'FailedAuthAttempts'
    Namespace: 'TakionOCR/Security'
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
```

### 9.5 コンプライアンス

**データ保護規制:**
- **GDPR**: EU一般データ保護規則準拠
- **個人情報保護法**: 日本の個人情報保護法準拠
- **SOC 2**: セキュリティ統制フレームワーク

**セキュリティ基準:**
- **OWASP Top 10**: Webアプリケーションセキュリティ
- **AWS Well-Architected**: セキュリティピラー準拠
- **ISO 27001**: 情報セキュリティマネジメント

------

## 第10章: パフォーマンス要件（拡張版）

### 10.1 処理時間目標（根拠付き）

**目標値と算出根拠:**

| ページ数 | Textract | Tesseract | 根拠 |
|----------|----------|-----------|------|
| 1ページ | 15秒以内 | 45秒以内 | API応答時間3秒 + 処理時間12秒 |
| 5ページ | 45秒以内 | 180秒以内 | 並列処理考慮、線形スケール |
| 10ページ | 90秒以内 | 300秒以内 | Lambda制限5分以内 |
| 50ページ | 240秒以内 | 1200秒以内 | 分割処理、バッチ最適化 |

**レスポンス時間:**
- **ファイルアップロード**: 5秒以内（10MBファイル）
- **処理状況確認**: 1秒以内
- **結果取得**: 3秒以内

### 10.2 スケーラビリティ設計

**同時処理制御:**

```typescript
// キューイング戦略例
export class ProcessingQueue {
  private readonly maxConcurrent = 10;
  private readonly queue: ProcessingJob[] = [];
  private running = 0;

  async enqueue(job: ProcessingJob): Promise<void> {
    this.queue.push(job);
    await this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const job = this.queue.shift()!;
    
    try {
      await this.processJob(job);
    } finally {
      this.running--;
      await this.processNext();
    }
  }
}
```

**スケーリング設定:**
- **Lambda同時実行**: 最大100（アカウント制限考慮）
- **S3スループット**: 1000リクエスト/秒まで対応
- **DynamoDB**: オンデマンド課金モードで自動スケール
- **API Gateway**: 10,000リクエスト/秒まで対応

### 10.3 最適化項目（具体的施策）

**Lambda最適化:**

```typescript
// コールドスタート対策
export const handler = async (event: S3Event): Promise<void> => {
  // 初期化処理をグローバルスコープに移動
  if (!isInitialized) {
    await initializeServices();
    isInitialized = true;
  }

  // 処理実行
  await processEvent(event);
};

// 接続プール使用
const dynamoClient = new DynamoDBClient({
  maxAttempts: 3,
  retryMode: 'adaptive'
});
```

**並列処理最適化:**

```typescript
// PDF分割処理
export class PdfProcessor {
  async processLargePdf(pdfBuffer: Buffer): Promise<OcrResult> {
    const pages = await this.splitPdfPages(pdfBuffer);
    
    // ページ並列処理（最大5並列）
    const results = await Promise.allSettled(
      pages.map((page, index) => 
        this.processPage(page, index, { maxConcurrency: 5 })
      )
    );

    return this.mergeResults(results);
  }
}
```

**キャッシュ戦略:**
- **Parameter Store**: 設定値の5分間キャッシュ
- **DynamoDB**: 使用量データの1分間キャッシュ
- **S3**: 結果ファイルのCloudFront配信

### 10.4 パフォーマンス監視

**メトリクス収集:**

```typescript
// カスタムメトリクス送信
export class MetricsService {
  async recordProcessingTime(
    engine: string, 
    pageCount: number, 
    duration: number
  ): Promise<void> {
    await cloudWatch.putMetricData({
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
    }).promise();
  }
}
```

**パフォーマンステスト:**

```bash
# 負荷テスト実行
npm run test:load -- --concurrent 50 --duration 300s
npm run test:stress -- --ramp-up 10s --peak 100 --duration 600s
```

------

## 第11章: 運用・保守（新規追加）

### 11.1 バックアップ・復旧戦略

**データバックアップ:**

```yaml
# S3バックアップ設定
BackupBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: !Sub 'takion-ocr-backup-${Environment}'
    ReplicationConfiguration:
      Role: !GetAtt ReplicationRole.Arn
      Rules:
        - Id: BackupRule
          Status: Enabled
          Prefix: ''
          Destination:
            Bucket: !Sub 'arn:aws:s3:::takion-ocr-backup-${Environment}'
            StorageClass: GLACIER
```

**復旧手順:**
1. **データ復旧**: S3バックアップからの復元
2. **設定復旧**: Parameter Storeの設定復元
3. **アプリケーション復旧**: Lambda関数の再デプロイ
4. **動作確認**: 統合テストによる機能確認

**RTO/RPO目標:**
- **RTO（復旧時間目標）**: 4時間以内
- **RPO（復旧ポイント目標）**: 1時間以内

### 11.2 災害復旧（DR）計画

**マルチリージョン構成:**

```yaml
# DR環境設定
DRRegion: us-west-2
PrimaryRegion: us-east-1

# クロスリージョンレプリケーション
CrossRegionReplication:
  - Source: !Ref PrimaryBucket
    Destination: !Sub 'takion-ocr-dr-${DRRegion}'
```

**フェイルオーバー手順:**
1. **障害検知**: CloudWatchアラーム、ヘルスチェック
2. **影響評価**: 障害範囲・復旧時間の見積もり
3. **フェイルオーバー判断**: ビジネス影響度による判断
4. **DNS切り替え**: Route 53による自動フェイルオーバー
5. **動作確認**: DR環境での機能確認

### 11.3 容量計画・コスト管理

**使用量予測:**

```typescript
// 容量計画モデル
export class CapacityPlanner {
  calculateMonthlyUsage(
    dailyFiles: number,
    avgPagesPerFile: number,
    textractRatio: number
  ): UsageForecast {
    const monthlyPages = dailyFiles * avgPagesPerFile * 30;
    const textractPages = monthlyPages * textractRatio;
    const tesseractPages = monthlyPages * (1 - textractRatio);
    
    return {
      totalPages: monthlyPages,
      textractCost: textractPages * 0.0015,
      lambdaCost: this.calculateLambdaCost(monthlyPages),
      s3Cost: this.calculateS3Cost(dailyFiles * 30),
      totalCost: textractPages * 0.0015 + this.calculateLambdaCost(monthlyPages) + this.calculateS3Cost(dailyFiles * 30)
    };
  }
}
```

**コスト最適化:**
- **S3ライフサイクル**: 30日後IA、90日後Glacier
- **Lambda最適化**: メモリサイズの最適化
- **DynamoDB**: オンデマンドとプロビジョニングの使い分け
- **CloudWatch**: ログ保持期間の最適化

### 11.4 セキュリティ運用

**定期セキュリティ監査:**

```bash
# セキュリティスキャン実行
npm run security:scan
npm run security:dependencies  # 依存関係脆弱性チェック
npm run security:secrets      # シークレット漏洩チェック
```

**セキュリティ更新:**
- **月次**: 依存関係の脆弱性チェック・更新
- **四半期**: セキュリティ設定の見直し
- **年次**: ペネトレーションテスト実施

**インシデント対応:**
1. **検知**: セキュリティアラート、異常検知
2. **初期対応**: 影響範囲の特定、緊急遮断
3. **調査**: ログ分析、フォレンジック調査
4. **復旧**: 脆弱性修正、システム復旧
5. **事後対応**: 再発防止策、報告書作成

------

## 第12章: 国際化・多言語対応（新規追加）

### 12.1 多言語UI対応

**対応言語:**
- 日本語（デフォルト）
- 英語
- 中国語（簡体字）
- 韓国語

**実装方式:**

```typescript
// i18n設定例
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ja: { translation: require('./locales/ja.json') },
      en: { translation: require('./locales/en.json') },
      zh: { translation: require('./locales/zh.json') },
      ko: { translation: require('./locales/ko.json') }
    },
    lng: 'ja',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });
```

### 12.2 タイムゾーン対応

**タイムゾーン処理:**

```typescript
// タイムゾーン対応例
export class TimeZoneService {
  formatTimestamp(
    timestamp: string, 
    userTimezone: string = 'Asia/Tokyo'
  ): string {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(timestamp));
  }
}
```

### 12.3 OCR言語対応

**Tesseract言語設定:**

```typescript
// 多言語OCR設定
export const TESSERACT_LANGUAGES = {
  ja: 'jpn',
  en: 'eng',
  zh: 'chi_sim',
  ko: 'kor'
};

export class TesseractService {
  async processWithLanguage(
    imageBuffer: Buffer, 
    languages: string[]
  ): Promise<OcrResult> {
    const langString = languages
      .map(lang => TESSERACT_LANGUAGES[lang])
      .join('+');
    
    return await this.tesseract.recognize(imageBuffer, langString);
  }
}
```

------

## 付録A: トラブルシューティング

### A.1 よくある問題と解決方法

**問題1: Lambda関数がタイムアウトする**
```
症状: 処理が5分でタイムアウトする
原因: 大容量ファイルまたは複雑なPDF
解決: ファイル分割処理、並列処理の実装
```

**問題2: Textract API制限エラー**
```
症状: "ThrottlingException" エラー
原因: API呼び出し頻度制限
解決: 指数バックオフリトライ、レート制限実装
```

**問題3: S3アップロード失敗**
```
症状: ファイルアップロードが途中で止まる
原因: ネットワーク不安定、ファイルサイズ制限
解決: マルチパートアップロード、リトライ機能
```

### A.2 ログ分析方法

**エラーログ検索:**

```bash
# CloudWatch Logs Insights クエリ例
fields @timestamp, level, message, requestId
| filter level = "ERROR"
| sort @timestamp desc
| limit 100
```

**パフォーマンス分析:**

```bash
# 処理時間分析
fields @timestamp, data.processingTimeMs, data.pageCount
| filter data.processingTimeMs > 30000
| stats avg(data.processingTimeMs) by data.pageCount
```

------

## 付録B: API仕様書

### B.1 REST API エンドポイント

**POST /api/v1/ocr/process**

```json
{
  "description": "OCR処理を開始する",
  "parameters": {
    "file": "PDFファイル（multipart/form-data）",
    "engine": "textract | tesseract",
    "language": "ja | en | zh | ko"
  },
  "response": {
    "requestId": "req-12345-abcde",
    "status": "processing",
    "estimatedTime": 30
  }
}
```

**GET /api/v1/ocr/status/{requestId}**

```json
{
  "description": "処理状況を確認する",
  "response": {
    "requestId": "req-12345-abcde",
    "status": "completed | processing | failed",
    "progress": 75,
    "result": "結果データ（完了時のみ）"
  }
}
```

### B.2 WebSocket API

**接続エンドポイント:** `wss://api.example.com/ws`

**メッセージ形式:**

```json
{
  "type": "progress_update",
  "requestId": "req-12345-abcde",
  "data": {
    "progress": 50,
    "currentPage": 3,
    "totalPages": 6,
    "message": "ページ3を処理中..."
  }
}
```

------

## 付録C: 設定リファレンス

### C.1 環境変数一覧

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|------------|------|
| `NODE_ENV` | ○ | development | 実行環境 |
| `LOG_LEVEL` | × | info | ログレベル |
| `AWS_REGION` | ○ | us-east-1 | AWSリージョン |
| `TEXTRACT_MAX_PAGES_PER_MONTH` | × | 1000 | 月間制限 |
| `OCR_TIMEOUT_SECONDS` | × | 300 | タイムアウト |
| `MAX_RETRY_ATTEMPTS` | × | 3 | リトライ回数 |

### C.2 Parameter Store設定

| パラメータ名 | 型 | 説明 |
|--------------|----|----- |
| `/config/pdf-ocr/textract-enabled` | String | Textract有効化 |
| `/config/pdf-ocr/max-pages-per-month` | String | 月間制限 |
| `/config/pdf-ocr/alert-threshold` | String | アラート閾値 |

------

## 変更履歴

### v2.0 (2025-09-14)
- **重大な改善**: 料金制限値の統一（ローカル50ページ/月、AWS1000ページ/月）
- **セキュリティ強化**: 入力検証、セキュリティチェック機能追加
- **エラーハンドリング拡張**: リトライ・タイムアウト・部分失敗対応
- **運用機能追加**: バックアップ・DR・監視機能の詳細化
- **国際化対応**: 多言語UI・タイムゾーン対応
- **ドキュメント構造化**: 12章構成への拡張、付録追加
- **技術仕様明確化**: バージョン固定、根拠説明追加

### v1.0 (初版)
- 基本的なOCR機能仕様
- ローカル・AWS環境対応
- 基本的なフロントエンド仕様

------

**文書作成者**: Devin AI  
**最終更新**: 2025年9月14日  
**バージョン**: 2.0  
**承認者**: [承認者名を記入]
