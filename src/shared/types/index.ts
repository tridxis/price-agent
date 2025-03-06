export * from './price.type';
export * from './candle.type';
export * from './funding.type';

// Common type interfaces
export interface ExchangeInfo {
  exchange: string;
  timestamp: number;
}

export type TimeRange = '1h' | '24h' | '7d' | '30d' | '90d' | '180d' | '365d';
