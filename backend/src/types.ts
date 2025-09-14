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

export interface OcrConfig {
  textractEnabled: boolean;
  maxPagesPerMonth: number;
  maxFileSize: number;
  maxPagesPerFile: number;
  ocrTimeout: number;
  maxRetryAttempts: number;
}

export interface OcrResult {
  engine: string;
  inputFile: string;
  fileSize: number;
  pageCount: number;
  processingTimeMs: number;
  pages: {
    pageNumber: number;
    text: string;
    confidence: number;
    blockCount: number;
  }[];
  metadata: {
    timestamp: string;
    version: string;
    region: string;
  };
}

export interface UsageData {
  totalPages: number;
  totalFiles: number;
  lastUpdated: string;
}

export interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
  eventName: string;
}
