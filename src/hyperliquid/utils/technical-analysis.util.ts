import { Candle } from '../../shared/types/candle.type';

export interface MACD {
  value: number;
  signal: number;
  histogram: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

export interface IchimokuCloud {
  conversionLine: number; // Tenkan-sen
  baseLine: number; // Kijun-sen
  leadingSpanA: number; // Senkou Span A
  leadingSpanB: number; // Senkou Span B
  laggingSpan: number; // Chikou Span
}

export interface SupportResistance {
  supports: number[];
  resistances: number[];
}

export class TechnicalAnalysisUtil {
  static calculateRSI(prices: number[], period = 14): number {
    if (prices.length < period + 1) {
      return 50; // Default value if not enough data
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial gains and losses
    for (let i = 1; i <= period; i++) {
      const difference = prices[i] - prices[i - 1];
      if (difference >= 0) {
        gains += difference;
      } else {
        losses -= difference;
      }
    }

    // Calculate initial averages
    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate subsequent values using Wilder's smoothing
    for (let i = period + 1; i < prices.length; i++) {
      const difference = prices[i] - prices[i - 1];
      if (difference >= 0) {
        avgGain = (avgGain * (period - 1) + difference) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - difference) / period;
      }
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  static calculateMACD(prices: number[]): MACD {
    if (prices.length < 26) {
      return { value: 0, signal: 0, histogram: 0 };
    }

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;

    // Calculate signal line (9-day EMA of MACD)
    const macdHistory = prices.map((_, i) => {
      const slice = prices.slice(0, i + 1);
      const ema12 = this.calculateEMA(slice, 12);
      const ema26 = this.calculateEMA(slice, 26);
      return ema12 - ema26;
    });

    const signalLine = this.calculateEMA(macdHistory, 9);
    const histogram = macdLine - signalLine;

    return {
      value: macdLine,
      signal: signalLine,
      histogram: histogram,
    };
  }

  static calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices[prices.length - 1] || 0;
    }

    const multiplier = 2 / (period + 1);
    let ema =
      prices.slice(0, period).reduce((sum, price) => sum + price) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  static findSupportResistance(candles: Candle[]): SupportResistance {
    if (candles.length < 10) {
      const currentPrice = candles[candles.length - 1]?.close || 0;
      return {
        supports: [currentPrice * 0.99],
        resistances: [currentPrice * 1.01],
      };
    }

    const pivots = candles.map((c) => ({
      high: c.high,
      low: c.low,
      volume: c.volume,
    }));

    const supports: number[] = [];
    const resistances: number[] = [];
    const windowSize = 5;

    // Find pivot points with volume confirmation
    for (let i = windowSize; i < pivots.length - windowSize; i++) {
      const currentPivot = pivots[i];
      const leftWindow = pivots.slice(i - windowSize, i);
      const rightWindow = pivots.slice(i + 1, i + windowSize + 1);

      // Check for resistance
      if (
        leftWindow.every((p) => p.high <= currentPivot.high) &&
        rightWindow.every((p) => p.high <= currentPivot.high) &&
        currentPivot.volume > pivots[i - 1].volume
      ) {
        resistances.push(currentPivot.high);
      }

      // Check for support
      if (
        leftWindow.every((p) => p.low >= currentPivot.low) &&
        rightWindow.every((p) => p.low >= currentPivot.low) &&
        currentPivot.volume > pivots[i - 1].volume
      ) {
        supports.push(currentPivot.low);
      }
    }

    // If no levels found, use recent highs and lows
    if (supports.length === 0) {
      const recentLows = candles.slice(-20).map((c) => c.low);
      supports.push(Math.min(...recentLows));
    }

    if (resistances.length === 0) {
      const recentHighs = candles.slice(-20).map((c) => c.high);
      resistances.push(Math.max(...recentHighs));
    }

    return {
      supports: [...new Set(supports)].sort((a, b) => a - b),
      resistances: [...new Set(resistances)].sort((a, b) => a - b),
    };
  }

  static calculateBollingerBands(
    prices: number[],
    period = 20,
    multiplier = 2,
  ): BollingerBands {
    if (prices.length < period) {
      return {
        upper: prices[prices.length - 1] || 0,
        middle: prices[prices.length - 1] || 0,
        lower: prices[prices.length - 1] || 0,
        bandwidth: 0,
      };
    }

    const sma = prices.slice(-period).reduce((a, b) => a + b) / period;
    const squaredDiffs = prices
      .slice(-period)
      .map((price) => Math.pow(price - sma, 2));
    const standardDeviation = Math.sqrt(
      squaredDiffs.reduce((a, b) => a + b) / period,
    );

    const upper = sma + multiplier * standardDeviation;
    const lower = sma - multiplier * standardDeviation;
    const bandwidth = (upper - lower) / sma;

    return { upper, middle: sma, lower, bandwidth };
  }

  static calculateIchimokuCloud(candles: Candle[]): IchimokuCloud {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    // Conversion Line (Tenkan-sen) - 9-period high/low average
    const conversionLine = this.calculateIchimokuLine(highs, lows, 9);

    // Base Line (Kijun-sen) - 26-period high/low average
    const baseLine = this.calculateIchimokuLine(highs, lows, 26);

    // Leading Span A (Senkou Span A) - Average of conversion & base lines
    const leadingSpanA = (conversionLine + baseLine) / 2;

    // Leading Span B (Senkou Span B) - 52-period high/low average
    const leadingSpanB = this.calculateIchimokuLine(highs, lows, 52);

    // Lagging Span (Chikou Span) - Current closing price shifted back 26 periods
    const laggingSpan = closes[closes.length - 26] || closes[closes.length - 1];

    return {
      conversionLine,
      baseLine,
      leadingSpanA,
      leadingSpanB,
      laggingSpan,
    };
  }

  private static calculateIchimokuLine(
    highs: number[],
    lows: number[],
    period: number,
  ): number {
    const periodHighs = highs.slice(-period);
    const periodLows = lows.slice(-period);
    return (Math.max(...periodHighs) + Math.min(...periodLows)) / 2;
  }

  static detectDivergence(
    prices: number[],
    rsi: number[],
    lookback = 10,
  ): {
    bullish: boolean;
    bearish: boolean;
  } {
    const recentPrices = prices.slice(-lookback);
    const recentRSI = rsi.slice(-lookback);

    const priceMin = Math.min(...recentPrices);
    const priceMax = Math.max(...recentPrices);
    const rsiMin = Math.min(...recentRSI);
    const rsiMax = Math.max(...recentRSI);

    // Bullish divergence: Price making lower lows but RSI making higher lows
    const bullish =
      prices[prices.length - 1] <= priceMin && rsi[rsi.length - 1] > rsiMin;

    // Bearish divergence: Price making higher highs but RSI making lower highs
    const bearish =
      prices[prices.length - 1] >= priceMax && rsi[rsi.length - 1] < rsiMax;

    return { bullish, bearish };
  }

  static detectVolumeTrend(
    candles: Candle[],
    period = 20,
  ): 'increasing' | 'decreasing' | 'neutral' {
    const volumes = candles.map((c) => c.volume);
    const recentVolumes = volumes.slice(-period);
    const volumeSMA = recentVolumes.reduce((a, b) => a + b) / period;
    const currentVolume = volumes[volumes.length - 1];

    if (currentVolume > volumeSMA * 1.5) return 'increasing';
    if (currentVolume < volumeSMA * 0.5) return 'decreasing';
    return 'neutral';
  }
}
