# AWS Lambda デプロイ手順

以下は、このプロジェクトを AWS Lambda にデプロイする手順です。

## 必要な準備
1. AWS CLI をインストールし、設定を行います。
   ```bash
   aws configure
   ```

2. 必要な IAM ロールを作成し、Lambda 関数にアタッチします。

## デプロイ手順
1. 必要な依存関係をインストールします。
   ```bash
   npm install
   ```

2. プロジェクトを ZIP ファイルに圧縮します。
   ```bash
   zip -r function.zip .
   ```

3. AWS Lambda 関数を作成します。
   ```bash
   aws lambda create-function \
     --function-name MyOCRFunction \
     --runtime nodejs18.x \
     --role arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_LAMBDA_ROLE \
     --handler index.handler \
     --zip-file fileb://function.zip
   ```

4. 必要に応じて環境変数を設定します。
   ```bash
   aws lambda update-function-configuration \
     --function-name MyOCRFunction \
     --environment Variables={KEY1=VALUE1,KEY2=VALUE2}
   ```

5. Lambda 関数をテストします。
   ```bash
   aws lambda invoke \
     --function-name MyOCRFunction \
     --payload '{"key": "value"}' \
     output.json
   ```

## 注意
- Lambda 関数のタイムアウトやメモリサイズは、必要に応じて設定してください。
- デプロイを自動化する場合は、AWS SAM や Terraform の使用を検討してください。