export interface HyperliquidMarketData {
  timestamp: number;
  market: string;
  price: number;
  volume24h: number;
  openInterest: number;
}

export interface HistoricalDataParams {
  market: string;
  startTime: number;
  endTime: number;
  interval: TimeInterval;
}

export interface HyperliquidHistoricalData {
  market: string;
  data: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export enum TimeInterval {
  MINUTE_1 = '1m',
  MINUTE_5 = '5m',
  HOUR_1 = '1h',
  DAY_1 = '1d',
}
