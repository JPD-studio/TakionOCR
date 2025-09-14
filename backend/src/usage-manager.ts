import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { ConfigManager } from './config-manager';
import { OcrError } from './errors';
import { ErrorType, UsageData } from './types';
import { Logger } from './logger';

export class UsageManager {
  private dynamoClient = new DynamoDBClient({});
  private tableName = process.env.DYNAMODB_USAGE_TABLE!;
  
  constructor(private logger: Logger) {}
  
  async checkUsageLimit(additionalPages: number): Promise<void> {
    if (!this.tableName) {
      this.logger.info('Usage limit check skipped (no table configured)');
      return;
    }
    
    const currentMonth = this.getCurrentMonthKey();
    const usage = await this.getCurrentUsage(currentMonth);
    const config = await new ConfigManager().getConfig();
    
    if (usage.totalPages + additionalPages > config.maxPagesPerMonth) {
      throw new OcrError(
        ErrorType.QUOTA_EXCEEDED,
        `Monthly page limit exceeded: ${usage.totalPages + additionalPages}/${config.maxPagesPerMonth}`,
        false,
        { currentUsage: usage.totalPages, limit: config.maxPagesPerMonth }
      );
    }
    
    const threshold = config.maxPagesPerMonth * 0.8;
    if (usage.totalPages + additionalPages > threshold) {
      this.logger.warn('Usage approaching limit', {
        currentUsage: usage.totalPages,
        limit: config.maxPagesPerMonth,
        threshold
      });
    }
  }
  
  async updateUsage(pageCount: number): Promise<void> {
    if (!this.tableName) {
      this.logger.info('Usage update skipped (no table configured)');
      return;
    }
    
    const currentMonth = this.getCurrentMonthKey();
    
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: {
        PK: { S: currentMonth },
        SK: { S: 'TOTAL' }
      },
      UpdateExpression: 'ADD totalPages :pages, totalFiles :files SET lastUpdated = :timestamp',
      ExpressionAttributeValues: {
        ':pages': { N: pageCount.toString() },
        ':files': { N: '1' },
        ':timestamp': { S: new Date().toISOString() }
      }
    });
    
    await this.dynamoClient.send(command);
  }
  
  private async getCurrentUsage(monthKey: string): Promise<UsageData> {
    if (!this.tableName) {
      return { totalPages: 0, totalFiles: 0, lastUpdated: new Date().toISOString() };
    }
    
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: { S: monthKey },
        SK: { S: 'TOTAL' }
      }
    });
    
    const response = await this.dynamoClient.send(command);
    
    if (!response.Item) {
      return { totalPages: 0, totalFiles: 0, lastUpdated: new Date().toISOString() };
    }
    
    return {
      totalPages: parseInt(response.Item.totalPages?.N || '0'),
      totalFiles: parseInt(response.Item.totalFiles?.N || '0'),
      lastUpdated: response.Item.lastUpdated?.S || new Date().toISOString()
    };
  }
  
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `USAGE#${now.getFullYear()}#${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
