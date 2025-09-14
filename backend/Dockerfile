# Lambda のベースイメージを使用（Node.js 18）
FROM public.ecr.aws/lambda/nodejs:18

# 作業ディレクトリを設定
WORKDIR ${LAMBDA_TASK_ROOT}

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール（本番環境のみ）
RUN npm ci --only=production && npm cache clean --force

# TypeScript をコンパイルしたファイルをコピー
COPY dist/ ./dist/

# Lambda ハンドラーを設定
CMD ["dist/lambda-handler.handler"]
