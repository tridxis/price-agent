export interface QuestionIntent {
  type: 'price' | 'funding' | 'trend' | 'comparison' | 'technical';
  action?: string;
  targets: string[];
  timeframe: 'current' | '1h' | '24h' | '7d';
}
