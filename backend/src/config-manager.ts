import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { OcrConfig } from './types';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export class ConfigManager {
  private ssmClient = new SSMClient({});
  private cache = new Map<string, { value: string; expires: number }>();
  
  async getParameter(name: string): Promise<string> {
    // Local development: use environment variables
    const envKey = name.replace('/config/pdf-ocr/', '').toUpperCase();
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      return envValue;
    }
    
    const cached = this.cache.get(name);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
    
    const command = new GetParametersCommand({
      Names: [name],
      WithDecryption: true
    });
    
    const response = await this.ssmClient.send(command);
    const value = response.Parameters?.[0]?.Value || '';
    
    this.cache.set(name, {
      value,
      expires: Date.now() + 5 * 60 * 1000
    });
    
    return value;
  }
  
  async getConfig(): Promise<OcrConfig> {
    const [
      textractEnabled,
      maxPagesPerMonth,
      maxFileSize,
      maxPagesPerFile,
      ocrTimeout,
      maxRetryAttempts
    ] = await Promise.all([
      this.getParameter('/config/pdf-ocr/textract-enabled'),
      this.getParameter('/config/pdf-ocr/max-pages-per-month'),
      this.getParameter('/config/pdf-ocr/max-file-size-mb'),
      this.getParameter('/config/pdf-ocr/max-pages-per-file'),
      this.getParameter('/config/pdf-ocr/ocr-timeout-seconds'),
      this.getParameter('/config/pdf-ocr/max-retry-attempts')
    ]);
    
    return {
      textractEnabled: textractEnabled === 'true',
      maxPagesPerMonth: parseInt(maxPagesPerMonth) || 1000,
      maxFileSize: parseInt(maxFileSize) || 10,
      maxPagesPerFile: parseInt(maxPagesPerFile) || 50,
      ocrTimeout: parseInt(ocrTimeout) || 300,
      maxRetryAttempts: parseInt(maxRetryAttempts) || 3
    };
  }
}
