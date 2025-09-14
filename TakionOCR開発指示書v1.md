# TakionOCR - 開発指示書（Devin向け修正版）

------

## 0. プロジェクト概要

TakionOCR は、PDF ファイルを対象に複数の OCR エンジン（AWS Textract, Tesseract など）を利用してテキスト抽出を行うシステムである。

- **リポジトリは共通**であり、ローカル開発と AWS 本番デプロイの両方に対応する。
- **環境ごとにエントリーポイントと設定を切替える**方式を採用する。
- **ローカル環境:** 開発・テストを実施
- **AWS環境:** Lambda + S3 + Amplify で本番運用

### 0.1 初期セットアップ

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
   mkdir -p output logs samples
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

- Node.js 18.x 以上（最新 LTS 推奨）
- TypeScript 4.9 以上
- ローカル用エントリーポイント `backend/src/local-runner.ts` を利用する。
- **AWS認証情報の設定（Textract使用時のみ）:**
  - AWS CLI設定済み（`aws configure`）、または
  - 環境変数 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` が設定済み、または
  - EC2/ECS等でIAMロールを利用
- **Tesseract言語データ:** `tesseract.js` が自動でダウンロードするため事前インストール不要
- 環境変数はリポジトリルートの `.env.local` ファイルで管理する。

### 1.2 環境変数設定

**`.env.local` の例:**

```bash
# 共通設定
LOG_LEVEL=debug

# モックデータ使用（Textract料金節約用）
USE_MOCK_DATA=false

# AWS設定（Textract使用時）
AWS_REGION=us-east-1
TEXTRACT_MAX_PAGES_PER_MONTH=100

# Tesseract設定
TESSERACT_LANGUAGE=jpn+eng
```

### 1.3 実行方法

**`backend/package.json` の `scripts` の例:**

```json
{
  "scripts": {
    "build": "tsc",
    "ocr-local": "ts-node src/local-runner.ts",
    "test": "jest",
    "dev": "nodemon --exec ts-node src/local-runner.ts"
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

# ヘルプ表示
npm run ocr-local -- --help
```

### 1.4 処理フロー

1. コマンドライン引数で指定されたファイルを読み込む。
2. ファイル形式（PDF）を検証する。
3. 指定されたエンジンでOCRを実行する。
4. 結果を指定ディレクトリ（デフォルト: `./output/`）にJSON形式で保存する。
5. ログを `./logs/` ディレクトリとコンソールに出力する。
6. **エラー発生時は** `./output/[timestamp]-error.json` にエラー詳細を保存する。

### 1.5 ローカル限定仕様

- **ストレージ**: ローカルファイルシステムを利用する。

  - 入力: `./samples/` （または任意のパス）
  - 出力: `./output/` （または `--output` オプション指定先）
  - ログ: `./logs/`

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
- **Amplify Hosting:** フロントエンド用（Cognito認証付き）
- **IAM権限:** Lambda実行ロールに以下権限が必要:
  - `textract:DetectDocumentText`, `textract:AnalyzeDocument`
  - `s3:GetObject`, `s3:PutObject`
  - `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`
  - `ssm:GetParameter`
  - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

### 2.2 AWS環境変数・パラメータ設定

**Lambda環境変数:**

```bash
NODE_ENV=production
S3_INPUT_BUCKET=takion-ocr-input-bucket
S3_OUTPUT_BUCKET=takion-ocr-output-bucket
DYNAMODB_USAGE_TABLE=TakionOcrUsage
```

**Parameter Store設定:**

```bash
/config/pdf-ocr/textract-enabled = "true"
/config/pdf-ocr/max-pages-per-month = "500"  
/config/pdf-ocr/alert-threshold = "0.8"
```

### 2.3 処理フロー

1. ユーザーがフロントエンドからS3の `input/` プレフィックスにPDFをアップロードする。
2. S3イベント（`s3:ObjectCreated:*`）がLambda関数をトリガーする。
3. Lambda関数が以下を実行:
   - Parameter Storeから設定値を取得
   - DynamoDBで月間使用量をチェック（料金制限）
   - 制限内であればOCRを実行
   - 使用量をDynamoDBに更新
4. 結果をS3の `results/[original-filename]/[timestamp]-result.json` に保存する。
5. **処理失敗時:**
   - CloudWatch Logsにエラー詳細を記録
   - SQSのDead Letter Queueにメッセージを送信
   - S3の `errors/` プレフィックスにエラー情報を保存
6. フロントエンドは結果をS3から取得して表示する。

### 2.4 料金制限ロジック

**DynamoDB テーブル構造:**

```json
{
  "PK": "USAGE#2025#09",  // 年月をキーとする
  "totalPages": 234,      // 処理済みページ数
  "lastUpdated": "2025-09-07T12:34:56Z",
  "TTL": 1672531200       // 自動削除用（3ヶ月後）
}
```

**制限チェックロジック:**

1. 現在の年月でDynamoDBから使用量を取得
2. `totalPages + 予定処理ページ数 > maxPagesPerMonth` の場合、処理を中断
3. 処理後、使用量を更新

### 2.5 緊急停止機能

**Parameter Store値による制御:**

- パス: `/config/pdf-ocr/textract-enabled`
- 値: `"false"` に設定することで即座にTextract呼び出しを無効化
- Lambda関数は実行時に毎回この値をチェック

------

## 第3章: 共通技術仕様

※ ローカル/本番環境で共通の仕様。

### 3.1 対応ファイル形式

- **入力形式:** PDF のみ
- **最大ファイルサイズ:** 10MB （Lambda制限考慮）
- **最大ページ数:** 50ページ （処理時間制限考慮）

### 3.2 OCRエンジン仕様

**Textract:**

- **精度:** 高精度（特に表組み、手書き文字）
- **コスト:** $0.0015/ページ（2025年現在）
- **制限:** 最大3000ページ/分
- **言語:** 英語、日本語など多言語対応

**Tesseract:**

- **精度:** 中程度（印刷文字に適している）
- **コスト:** 無料
- **制限:** 処理時間がファイルサイズに比例
- **言語:** 設定可能（デフォルト: 日本語+英語）

### 3.3 JSON出力形式

**成功時の出力:**

```json
{
  "engine": "textract",
  "inputFile": "document.pdf", 
  "fileSize": 2048000,
  "pageCount": 3,
  "processingTimeMs": 5420,
  "pages": [
    { 
      "pageNumber": 1, 
      "text": "抽出されたテキスト内容...",
      "confidence": 0.95,
      "blockCount": 12
    },
    { 
      "pageNumber": 2, 
      "text": "2ページ目のテキスト...",
      "confidence": 0.98,
      "blockCount": 8  
    }
  ],
  "metadata": {
    "timestamp": "2025-09-07T12:34:56.789Z",
    "version": "1.0.0",
    "region": "us-east-1"
  }
}
```

**エラー時の出力:**

```json
{
  "error": true,
  "errorType": "PROCESSING_ERROR",
  "errorMessage": "Failed to extract text from page 2",
  "inputFile": "document.pdf",
  "engine": "textract", 
  "timestamp": "2025-09-07T12:34:56.789Z",
  "errorDetails": {
    "stack": "Error stack trace...",
    "requestId": "12345-abcde"
  }
}
```

### 3.4 エラーハンドリング分類

**エラータイプ定義:**

- `FILE_ERROR`: ファイル読み込み/形式エラー
- `SIZE_LIMIT_ERROR`: ファイルサイズ超過
- `QUOTA_EXCEEDED`: 料金制限による処理停止
- `OCR_ENGINE_ERROR`: OCRエンジン自体のエラー
- `NETWORK_ERROR`: AWS API呼び出し失敗
- `CONFIGURATION_ERROR`: 設定値の問題

### 3.5 ログ仕様

**ログレベル:**

- `DEBUG`: 詳細な処理情報
- `INFO`: 処理開始/完了の要約
- `WARN`: 警告（制限に近づいている等）
- `ERROR`: エラー情報

**ログ出力先:**

- ローカル: `./logs/app-[YYYY-MM-DD].log`
- AWS: CloudWatch Logs（ロググループ: `/aws/lambda/takion-ocr`）

### 3.6 主要な依存ライブラリ

| 領域               | ライブラリ                 | バージョン | 目的                        |
| ------------------ | -------------------------- | ---------- | --------------------------- |
| **バックエンド**   | `typescript`               | ^4.9.0     | TypeScript開発              |
|                    | `ts-node`                  | ^10.9.0    | TypeScriptコードを直接実行  |
|                    | `@aws-sdk/client-textract` | ^3.400.0   | AWS Textract API 連携       |
|                    | `@aws-sdk/client-s3`       | ^3.400.0   | S3操作                      |
|                    | `@aws-sdk/client-dynamodb` | ^3.400.0   | DynamoDB操作                |
|                    | `tesseract.js`             | ^4.1.0     | Tesseract OCR エンジン      |
|                    | `yargs`                    | ^17.7.0    | コマンドライン引数の解析    |
|                    | `winston`                  | ^3.10.0    | ログ管理                    |
|                    | `pdf-parse`                | ^1.1.1     | PDF解析・ページ数取得       |
| **フロントエンド** | `react`                    | ^18.2.0    | UI構築                      |
|                    | `@aws-amplify/ui-react`    | ^5.0.0     | Amplify連携UIコンポーネント |
|                    | `@aws-amplify/storage`     | ^5.0.0     | S3ファイルアップロード      |

------

## 第4章: フロントエンド仕様

### 4.1 技術スタック

- **フレームワーク**: React 18.x + TypeScript
- **UIライブラリ**: AWS Amplify UI React
- **状態管理**: React Hooks（useState, useContext）
- **認証**: Amazon Cognito
- **ファイルアップロード**: Amplify Storage (S3)

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

### 4.3 主要画面仕様

**1. ファイルアップロード画面:**

- PDFファイルのドラッグ&ドロップ対応
- ファイルサイズ制限表示（10MB）
- OCRエンジン選択（Textract/Tesseract）
- アップロード進捗表示

**2. 処理状況確認画面:**

- 処理中ファイル一覧
- 進捗状況のリアルタイム更新
- エラー発生時の詳細表示

**3. 結果表示画面:**

- 抽出テキストの表示・編集
- ページ別表示切り替え
- テキストのコピー・ダウンロード機能
- 信頼度スコア表示（Textractの場合）

### 4.4 認証フロー

1. ユーザーはCognitoユーザープールでサインアップ/サインイン
2. JWT トークンを取得してS3アクセス権限を獲得
3. 認証済みユーザーのみファイルアップロード可能
4. ユーザー別のS3プレフィックスでファイル分離

------

## 第5章: 開発・デプロイ要件

### 5.1 ローカル開発環境

**必須ツール:**

- Node.js 18.x 以上
- npm または yarn
- AWS CLI（Textract使用時）
- Git

**開発フロー:**

1. 機能開発: `npm run dev` でホットリロード開発
2. ユニットテスト: `npm run test`
3. 統合テスト: `npm run ocr-local` で実際のファイル処理テスト
4. ビルドテスト: `npm run build`

### 5.2 AWSデプロイメント

**CI/CDパイプライン（推奨）:**

**1. フロントエンド（Amplify）:**

```yaml
# amplify.yml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend && npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/build
    files:
      - '**/*'
```

**2. バックエンド（AWS SAM）:**

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  TakionOcrFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: backend/
      Handler: src/lambda-handler.handler
      Runtime: nodejs18.x
      Timeout: 300
      MemorySize: 1024
      Environment:
        Variables:
          S3_INPUT_BUCKET: !Ref InputBucket
          S3_OUTPUT_BUCKET: !Ref OutputBucket
          DYNAMODB_USAGE_TABLE: !Ref UsageTable
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
```

**デプロイコマンド:**

```bash
# SAMデプロイ
cd backend
sam build
sam deploy --guided

# Amplifyデプロイ（GitHubプッシュで自動実行）
git push origin main
```

### 5.3 環境別設定管理

**ローカル環境:**

- `.env.local` ファイルで管理
- Git に含めない（`.gitignore` に追加）

**AWS環境:**

- Lambda環境変数 + Parameter Store の組み合わせ
- 機密情報はParameter Store（SecureString）で管理

------

## 第6章: フォルダ構造

```plaintext
takion-ocr/
├─ backend/
│   ├─ src/
│   │  ├─ services/
│   │  │  ├─ ocrService.ts       # OCR共通処理
│   │  │  ├─ textractService.ts  # Textract固有処理  
│   │  │  ├─ tesseractService.ts # Tesseract固有処理
│   │  │  ├─ s3Service.ts        # S3操作（AWS環境用）
│   │  │  ├─ usageService.ts     # 料金制限ロジック
│   │  │  └─ configService.ts    # 設定管理
│   │  ├─ utils/
│   │  │  ├─ logger.ts           # ログ管理
│   │  │  ├─ validators.ts       # 入力検証
│   │  │  └─ errorHandler.ts     # エラーハンドリング
│   │  ├─ types/
│   │  │  └─ index.ts            # 型定義
│   │  ├─ local-runner.ts        # ローカル専用エントリーポイント
│   │  └─ lambda-handler.ts      # Lambda専用ハンドラ
│   ├─ tests/                    # テストファイル
│   ├─ package.json
│   ├─ tsconfig.json
│   └─ template.yaml             # SAM設定ファイル
├─ frontend/
│   ├─ src/
│   │  ├─ components/           # React コンポーネント
│   │  ├─ hooks/                # カスタムフック
│   │  ├─ services/             # API呼び出し
│   │  ├─ types/                # TypeScript型定義
│   │  └─ utils/                # ユーティリティ関数  
│   ├─ public/
│   ├─ package.json
│   └─ amplify.yml              # Amplify設定ファイル
├─ output/                      # ローカル実行時の出力先
├─ logs/                        # ローカル実行時のログ
├─ samples/                     # テスト用PDFファイル
│   ├─ mock-responses/          # モックレスポンス用
│   └─ test-documents/          # テスト用PDF
├─ docs/                        # 追加ドキュメント
├─ .env.example                 # 環境変数テンプレート  
├─ .env.local                   # ローカル用環境変数（Git管理外）
├─ .gitignore
└─ README.md
```

------

## 第7章: テスト要件

### 7.1 ユニットテスト

**対象:** 各サービスクラスの個別メソッド

**ツール:** Jest + TypeScript

**実行方法:**

```bash
cd backend
npm run test
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジレポート生成
```

### 7.2 統合テスト

**対象:** OCRエンジン呼び出しを含む全体フロー

**テストケース:**

- 正常系: 各エンジンでのテキスト抽出
- 異常系: ファイルサイズ超過、不正形式ファイル
- 制限系: 料金制限による処理停止

### 7.3 E2Eテスト（推奨）

**対象:** フロントエンドから結果表示までの全フロー

**ツール:** Playwright または Cypress

**実行環境:** ステージング環境推奨

------

## 第8章: 監視・運用

### 8.1 メトリクス監視

**CloudWatch メトリクス:**

- Lambda実行回数、エラー率、実行時間
- S3アップロード数
- DynamoDB読み書き回数
- Textract API呼び出し数

### 8.2 アラート設定

**料金アラート:**

- 月間処理ページ数が上限の80%に達した場合
- Textract API呼び出し料金が予算の90%に達した場合

**エラーアラート:**

- Lambda関数のエラー率が5%を超えた場合
- DLQにメッセージが蓄積された場合

### 8.3 ログ分析

**重要ログ項目:**

- 処理時間の推移
- エンジン別の成功率
- ファイルサイズ分布
- エラー原因の分類

------

## 第9章: セキュリティ要件

### 9.1 認証・認可

- **フロントエンド**: Cognito User Pool による認証
- **API**: JWT トークン検証
- **S3アクセス**: ユーザー別IAMポリシーで制限

### 9.2 データ保護

- **転送時暗号化**: HTTPS/TLS 1.3
- **保存時暗号化**: S3バケット暗号化有効化
- **一時ファイル**: Lambda実行後の確実な削除

### 9.3 アクセス制御

- **最小権限の原則**: 各サービスに必要最小限の権限のみ付与
- **ネットワーク分離**: VPC設定（必要に応じて）
- **ログ監査**: CloudTrail によるAPI呼び出し記録
- **フロントエンド**: 静的ホスティングのため特別なアクセス制御不要

------

## 第10章: パフォーマンス要件

### 10.1 処理時間目標

- **1ページPDF**: 30秒以内（Textract）、60秒以内（Tesseract）
- **10ページPDF**: 3分以内（Textract）、10分以内（Tesseract）
- **レスポンス**: ファイルアップロード完了まで5秒以内

### 10.2 スケーラビリティ

- **Lambda同時実行**: 最大100（アカウント制限考慮）
- **S3スループット**: 1000リクエスト/秒まで対応
- **DynamoDB**: オンデマンド課金モードで自動スケール

### 10.3 最適化項目

- Lambda関数のコールドスタート対策
- PDF解析の並列処理化
- 大容量ファイルの分割処理
