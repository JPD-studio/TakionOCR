import { OcrError } from './errors';

export class RetryManager {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number,
    timeoutMs: number
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await Promise.race([
          operation(),
          this.createTimeoutPromise<T>(timeoutMs)
        ]);
      } catch (error) {
        lastError = error as Error;
        
        if (!this.isRetryableError(error)) {
          throw error;
        }
        
        if (attempt < maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError!;
  }
  
  private calculateBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
  }
  
  private isRetryableError(error: any): boolean {
    if (error.name === 'ThrottlingException') return true;
    if (error.name === 'ServiceUnavailableException') return true;
    if (error.name === 'InternalServerError') return true;
    
    if (error instanceof OcrError) return error.retryable;
    
    return false;
  }
  
  private createTimeoutPromise<T>(timeoutMs: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    });
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
