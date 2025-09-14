import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export class MetricsService {
  private cloudWatchClient = new CloudWatchClient({});
  
  async recordProcessingTime(
    engine: string,
    pageCount: number,
    duration: number
  ): Promise<void> {
    const command = new PutMetricDataCommand({
      Namespace: 'TakionOCR/Performance',
      MetricData: [
        {
          MetricName: 'ProcessingTime',
          Value: duration,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Engine', Value: engine },
            { Name: 'PageCount', Value: pageCount.toString() }
          ]
        }
      ]
    });
    
    await this.cloudWatchClient.send(command);
  }
  
  async recordError(errorType: string): Promise<void> {
    const command = new PutMetricDataCommand({
      Namespace: 'TakionOCR/Errors',
      MetricData: [
        {
          MetricName: 'ErrorCount',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'ErrorType', Value: errorType }
          ]
        }
      ]
    });
    
    await this.cloudWatchClient.send(command);
  }
}
