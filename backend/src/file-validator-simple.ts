export class FileValidator {
  private readonly maxFileSize = 10 * 1024 * 1024;
  private readonly maxPages = 50;
  
  async validateFile(fileBuffer: Buffer): Promise<void> {
    if (fileBuffer.length > this.maxFileSize) {
      throw new Error(`File size exceeds limit: ${fileBuffer.length}/${this.maxFileSize} bytes`);
    }
    
    if (!this.isPdfFile(fileBuffer)) {
      throw new Error('Invalid file format. Only PDF files are supported.');
    }
    
    const pageCount = await this.getPageCount(fileBuffer);
    if (pageCount > this.maxPages) {
      throw new Error(`Page count exceeds limit: ${pageCount}/${this.maxPages} pages`);
    }
  }
  
  async getPageCount(fileBuffer: Buffer): Promise<number> {
    try {
      // Simple PDF page count estimation by counting "Type /Page" occurrences
      const pdfContent = fileBuffer.toString('latin1');
      const pageMatches = pdfContent.match(/\/Type\s*\/Page[^s]/g);
      return pageMatches ? pageMatches.length : 1;
    } catch (error) {
      // Fallback: assume single page for parsing errors
      return 1;
    }
  }
  
  private isPdfFile(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).toString() === '%PDF';
  }
  
  private async performSecurityCheck(fileBuffer: Buffer): Promise<void> {
    // Basic security check - look for encryption markers
    const pdfContent = fileBuffer.toString('latin1');
    if (pdfContent.includes('/Encrypt')) {
      throw new Error('Encrypted PDF files are not supported');
    }
  }
}
