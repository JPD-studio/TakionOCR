import { ErrorType } from './types';

export class OcrError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public retryable: boolean = false,
    public details?: any
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
