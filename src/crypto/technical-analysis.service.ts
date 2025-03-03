import { Injectable } from '@nestjs/common';
import { TimeframedPriceData } from './types/price.type';

@Injectable()
export class TechnicalAnalysisService {
  calculateMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  calculateRSI(prices: number[], period = 14): number {
    if (prices.length < period + 1) return 0;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = prices[prices.length - i] - prices[prices.length - i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  findSupportResistance(
    data: TimeframedPriceData[],
    lookback = 30,
  ): {
    support: number;
    resistance: number;
  } {
    const prices = data.map((d) => ({
      high: d.highPrice || d.averagePrice,
      low: d.lowPrice || d.averagePrice,
    }));

    const recentPrices = prices.slice(-lookback);

    const support = Math.min(...recentPrices.map((p) => p.low));
    const resistance = Math.max(...recentPrices.map((p) => p.high));

    return { support, resistance };
  }

  analyzeTrend(
    data: TimeframedPriceData[],
    period = 14,
  ): {
    trend: 'bullish' | 'bearish' | 'sideways';
    strength: number;
    description: string;
  } {
    const prices = data.map((d) => d.averagePrice);
    const ma20 = this.calculateMA(prices, 20);
    const ma50 = this.calculateMA(prices, 50);
    const rsi = this.calculateRSI(prices);

    let trend: 'bullish' | 'bearish' | 'sideways';
    let strength: number;

    if (ma20 > ma50 && rsi > 50) {
      trend = 'bullish';
      strength = Math.min(100, (rsi - 50) * 2);
    } else if (ma20 < ma50 && rsi < 50) {
      trend = 'bearish';
      strength = Math.min(100, (50 - rsi) * 2);
    } else {
      trend = 'sideways';
      strength = Math.min(100, Math.abs(50 - rsi));
    }

    return {
      trend,
      strength,
      description: `${trend.toUpperCase()} trend with ${strength.toFixed(1)}% strength. RSI: ${rsi.toFixed(1)}`,
    };
  }
}
