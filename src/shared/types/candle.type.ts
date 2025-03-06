export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
  interval: string;
}

export interface CandleResponse {
  t: number; // Start timestamp
  T: number; // End timestamp
  s: string; // Symbol
  i: string; // Interval
  o: string; // Open
  c: string; // Close
  h: string; // High
  l: string; // Low
  v: string; // Volume
  n: number; // Number of trades
}
