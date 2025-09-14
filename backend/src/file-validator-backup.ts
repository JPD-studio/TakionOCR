import pdfParse from 'pdf-parse';
import { OcrError } from './errors';
import { ErrorType } from './types';

export class FileValidator {
  private readonly maxFileSize = 10 * 1024 * 1024;
  private readonly maxPages = 50;
  
  async validateFile(fileBuffer: Buffer): Promise<void> {
    if (fileBuffer.length > this.maxFileSize) {
      throw new OcrError(
        ErrorType.SIZE_LIMIT_ERROR,
        `File size exceeds limit: ${fileBuffer.length}/${this.maxFileSize} bytes`
      );
    }
    
    if (!this.isPdfFile(fileBuffer)) {
      throw new OcrError(
        ErrorType.FILE_ERROR,
        'Invalid file format. Only PDF files are supported.'
      );
    }
    
    const pageCount = await this.getPageCount(fileBuffer);
    if (pageCount > this.maxPages) {
      throw new OcrError(
        ErrorType.PAGE_LIMIT_ERROR,
        `Page count exceeds limit: ${pageCount}/${this.maxPages} pages`
      );
    }
    
    await this.performSecurityCheck(fileBuffer);
  }
  
  async getPageCount(fileBuffer: Buffer): Promise<number> {
    try {
      const pdfData = await pdfParse(fileBuffer);
      return pdfData.numpages;
    } catch (error) {
      throw new OcrError(
        ErrorType.FILE_ERROR,
        'Failed to parse PDF file for page count',
        false,
        { originalError: (error as Error).message }
      );
    }
  }
  
  private isPdfFile(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).toString() === '%PDF';
  }
  
  private async performSecurityCheck(fileBuffer: Buffer): Promise<void> {
    try {
      const pdfData = await pdfParse(fileBuffer);
      
      if (pdfData.info?.IsEncrypted) {
        throw new OcrError(
          ErrorType.SECURITY_ERROR,
          'Encrypted PDF files are not supported'
        );
      }
      
      if (JSON.stringify(pdfData.info).length > 10000) {
        throw new OcrError(
          ErrorType.SECURITY_ERROR,
          'PDF contains suspicious metadata'
        );
      }
      
    } catch (error) {
      if (error instanceof OcrError) throw error;
      
      throw new OcrError(
        ErrorType.FILE_ERROR,
        'Failed to parse PDF file',
        false,
        { originalError: (error as Error).message }
      );
    }
  }
}
