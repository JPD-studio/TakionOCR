import * as pdf2pic from 'pdf2pic';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from './logger';

// PDF画像変換の結果型
export interface PdfPageImage {
  pageNumber: number;
  imageBuffer: Buffer;
  tempPath?: string;
}

// PDF画像変換サービス（OCRと図形検出で共有）
export class PdfImageConverter {
  constructor(private logger: Logger) {}

  async convertPdfToImages(fileBuffer: Buffer, options?: {
    density?: number;
    format?: string;
    width?: number;
    height?: number;
  }): Promise<PdfPageImage[]> {
    const tempDir = '/tmp';
    const tempPdfPath = join(tempDir, `temp-pdf-${Date.now()}.pdf`);
    
    const {
      density = 150,
      format = 'png',
      width = 1024,
      height = 1024
    } = options || {};
    
    try {
      this.logger.info('Starting PDF to image conversion', { 
        fileSize: fileBuffer.length,
        options: { density, format, width, height }
      });
      
      // 一時PDFファイルとして保存
      writeFileSync(tempPdfPath, fileBuffer);
      
      // PDF → 画像変換設定
      const convert = pdf2pic.fromPath(tempPdfPath, {
        density,
        saveFilename: `page-${Date.now()}`,
        savePath: tempDir,
        format,
        width,
        height
      });

      const results = await convert.bulk(-1); // 全ページ変換
      
      this.logger.info('PDF conversion completed', { 
        pageCount: results.length 
      });
      
      // 画像ファイルを読み込んでPdfPageImageに変換
      const pageImages: PdfPageImage[] = results.map((result: { path?: string }, index: number) => {
        if (!result.path) {
          throw new Error(`PDF conversion failed for page ${index + 1}: no output path`);
        }
        
        const imageBuffer = readFileSync(result.path);
        
        // 一時ファイル削除
        try {
          unlinkSync(result.path);
        } catch (cleanupError) {
          this.logger.warn('Failed to cleanup temp image file', { 
            path: result.path,
            error: (cleanupError as Error).message 
          });
        }
        
        return {
          pageNumber: index + 1,
          imageBuffer,
          tempPath: result.path
        };
      });

      return pageImages;
      
    } finally {
      // 一時PDFファイル削除
      try {
        unlinkSync(tempPdfPath);
      } catch (cleanupError) {
        this.logger.warn('Failed to cleanup temp PDF', { 
          path: tempPdfPath,
          error: (cleanupError as Error).message 
        });
      }
    }
  }

  // 特定のページのみを変換する場合
  async convertSinglePage(fileBuffer: Buffer, pageNumber: number, options?: {
    density?: number;
    format?: string;
    width?: number;
    height?: number;
  }): Promise<PdfPageImage> {
    const allPages = await this.convertPdfToImages(fileBuffer, options);
    
    const targetPage = allPages.find(page => page.pageNumber === pageNumber);
    if (!targetPage) {
      throw new Error(`Page ${pageNumber} not found in PDF`);
    }
    
    return targetPage;
  }
}
