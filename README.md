# TakionOCR - AWS Lambda PDF OCR System

[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-orange.svg)](https://aws.amazon.com/lambda/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1.6-blue.svg)](https://www.typescriptlang.org/)
[![AWS Textract](https://img.shields.io/badge/AWS-Textract-green.svg)](https://aws.amazon.com/textract/)

AWS Lambda を使用した高性能PDF OCRシステム。図面やドキュメントからテキスト、フォーム、テーブルをページ毎に構造化抽出します。

## 🏗️ プロジェクト構造

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
│   ├── README.md          # 詳細技術文書
│   └── package.json       # 依存関係
├── samples/               # サンプル文書
│   └── test-documents/
├── output/                # OCR結果出力
└── README.md              # 本ファイル
```

## ✨ 主な機能

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

## 🚀 クイックスタート

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

```bash
# S3ベーステスト（推奨 - Lambda環境模擬）
npm run ocr-s3-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json"

# LocalStack使用（オフライン開発）
npm run ocr-s3-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json" --localstack

# 従来方式（開発用）
npm run ocr-local -- --file="../samples/test-documents/sample.pdf" --output="../output/result.json" --engine="textract-analyze"
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

## 📦 AWS Lambda デプロイ

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

## 🔧 設定

### 環境変数

| 変数名 | 説明 | デフォルト |
|-------|------|----------|
| `AWS_DEFAULT_REGION` | AWS リージョン | `us-east-1` |
| `OUTPUT_BUCKET` | 結果出力S3バケット | 入力バケット |
| `TEXTRACT_TIMEOUT` | Textract タイムアウト（秒） | `900` |
| `MAX_RETRY_ATTEMPTS` | リトライ最大回数 | `3` |

### IAM 権限

Lambda 実行ロールに以下の権限が必要：

- `textract:StartDocumentAnalysis`
- `textract:GetDocumentAnalysis`  
- `s3:GetObject` (入力バケット)
- `s3:PutObject` (出力バケット)
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

## 📊 処理性能

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

## 🧪 開発・テスト

### ファイル分類

**本番デプロイ必須:**
- `lambda-handler.ts` - Lambda エントリーポイント
- `lambda-ocr-processor.ts` - メイン処理
- `types.ts`, `logger.ts`, `config-manager.ts` など

**ローカル開発専用:**
- `local-runner.ts` - 従来方式テスト
- `local-s3-runner.ts` - S3方式テスト
- `tests/` - ユニットテスト

**条件付きデプロイ:**
- `ocr-processor.ts` - ECS等での使用可能
- `file-validator.ts` - オプション機能

### テスト実行

```bash
# ユニットテスト
npm test

# リント
npm run lint

# ビルド確認
npm run build
```

## 📈 監視・運用

### CloudWatch

- **ログ**: 構造化JSON形式
- **メトリクス**: 処理時間、エラー率、ページ数
- **アラーム**: エラー率、タイムアウト監視

### コスト最適化

- 非同期処理による効率化
- 不要機能除去によるパッケージサイズ削減
- S3 Intelligent-Tiering 使用推奨

## 🤝 貢献

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 ライセンス

MIT License

## 📞 サポート

技術的な詳細については [`backend/README.md`](backend/README.md) を参照してください。

---

**Built with ❤️ for high-performance document processing on AWS Lambda**
- デプロイを自動化する場合は、AWS SAM や Terraform の使用を検討してください。