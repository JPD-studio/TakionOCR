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
  rekognitionEnabled?: boolean;  // 追加: Rekognition形状検出のオンオフ
  maxPagesPerMonth: number;
  maxFileSize: number;
  maxPagesPerFile: number;
  ocrTimeout: number;
  maxRetryAttempts: number;
}

export interface TableCell {
  text: string;
  rowIndex: number;
  columnIndex: number;
}

export interface Table {
  cells: TableCell[];
  rows?: string[][];
}

// Shape Detection用の型定義
export interface ShapeTag {
  shape: 'circle' | 'ellipse' | 'oval' | 'rectangle' | 'square' | 'trapezoid' | 'triangle' | 'polygon' | 'unknown';
  confidence: number;
  detected_labels: string[];  // Rekognitionが検出した生のラベル
}

export interface PageShapeAnalysis {
  enabled: boolean;
  shapes: ShapeTag[];
  dominant_shape: string;
  shape_count: number;
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
    forms?: Array<{ key: string; value: string }>;
    tables?: Table[];
    shapes?: PageShapeAnalysis;  // 追加: ページ毎の形状分析結果
  }[];
  metadata: {
    timestamp: string;
    version: string;
    region: string;
  };
  forms?: Array<{ key: string; value: string }>;
  tables?: Table[];
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
