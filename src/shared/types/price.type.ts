export interface ExchangePrice {
  exchange: string;
  price: number;
  timestamp: number;
  volume?: number;
}

export interface PriceData {
  symbol: string;
  prices: ExchangePrice[];
  averagePrice: number;
}

export interface TimeframedPriceData extends PriceData {
  changes: {
    '1h': number;
    '24h': number;
    '7d': number;
    '30d': number;
    '90d'?: number;
    '180d'?: number;
    '365d'?: number;
  };
  date?: string;
  highPrice?: number;
  lowPrice?: number;
}
