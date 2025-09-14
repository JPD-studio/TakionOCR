export class Logger {
  constructor(private requestId: string) {}
  
  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }
  
  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }
  
  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }
  
  debug(message: string, data?: any): void {
    this.log('DEBUG', message, data);
  }
  
  private log(level: string, message: string, data?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: 'takion-ocr',
      version: '2.1',
      requestId: this.requestId,
      message,
      data,
      environment: process.env.NODE_ENV || 'development'
    };
    
    console.log(JSON.stringify(logEntry));
  }
}
