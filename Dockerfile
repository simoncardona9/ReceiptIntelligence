FROM node:24-alpine

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache python3 py3-pillow tesseract-ocr tesseract-ocr-data-spa poppler-utils

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["pnpm", "dev", "--hostname", "0.0.0.0"]
