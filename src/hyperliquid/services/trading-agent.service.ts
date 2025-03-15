import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HistoricalDataService } from '../../shared/services/historical-data.service';
import { Candle } from '../../shared/types/candle.type';
import { PriceTool } from '../../shared/tools/price.tool';
import { TechnicalAnalysisUtil } from '../utils/technical-analysis.util';
import {
  BollingerBands,
  IchimokuCloud,
} from '../utils/technical-analysis.util';

export interface TradingSignal {
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string[];
}

interface MarketCondition {
  trend: 'bullish' | 'bearish' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  momentum: number;
  rsi: number;
  rsiValues: number[];
  macd: {
    value: number;
    signal: number;
    histogram: number;
  };
  supports: number[];
  resistances: number[];
  candles: Candle[];
  volume: number;
}

interface StyleAnalysis {
  style: 'Scalping' | 'Day Trading' | 'Swing Trading' | 'Position Trading';
  confidence: number;
  reasons: string[];
  side: 'long' | 'short' | null;
  stopLoss?: number;
  takeProfit?: number;
}

@Injectable()
export class TradingAgentService {
  private readonly logger = new Logger(TradingAgentService.name);
  private readonly API_URL = 'https://api.hyperliquid.xyz/info';
  private cachedPrices: Map<string, number> = new Map();
  private lastPriceUpdate = 0;
  private readonly PRICE_TTL = 2 * 60 * 1000; // 2 minutes

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly historicalDataService: HistoricalDataService,
    private readonly priceTool: PriceTool,
  ) {}

  private calculateMarketCondition(candles: Candle[]): MarketCondition {
    const prices = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const volume = volumes[volumes.length - 1];

    // Calculate trend using EMA
    const ema20 = TechnicalAnalysisUtil.calculateEMA(prices, 20);
    const ema50 = TechnicalAnalysisUtil.calculateEMA(prices, 50);
    const trend =
      ema20 > ema50 ? 'bullish' : ema20 < ema50 ? 'bearish' : 'neutral';

    // Calculate volatility
    const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + r * r, 0) / returns.length,
    );
    const volatilityLevel =
      volatility > 0.03 ? 'high' : volatility > 0.01 ? 'medium' : 'low';

    // Calculate momentum
    const momentum = (prices[prices.length - 1] - prices[0]) / prices[0];

    // Calculate RSI for each candle
    const rsiValues = prices.map((_, i) => {
      const priceSlice = prices.slice(0, i + 1);
      return TechnicalAnalysisUtil.calculateRSI(priceSlice);
    });

    // Current RSI is the last value
    const rsi = rsiValues[rsiValues.length - 1];

    // Calculate MACD
    const macd = TechnicalAnalysisUtil.calculateMACD(prices);

    // Find support and resistance levels
    const { supports, resistances } =
      TechnicalAnalysisUtil.findSupportResistance(candles);

    return {
      trend,
      volatility: volatilityLevel,
      momentum,
      rsi,
      macd,
      supports,
      resistances,
      candles,
      rsiValues,
      volume,
    };
  }

  private analyzeAllStyles(
    coin: string,
    currentPrice: number,
    market3m: MarketCondition,
    market15m: MarketCondition,
    market1h: MarketCondition,
    market4h: MarketCondition,
  ): StyleAnalysis[] {
    const analyses: StyleAnalysis[] = [];

    // Scalping Analysis (3m + 15m confirmation)
    const scalpingAnalysis = this.analyzeScalping(
      coin,
      currentPrice,
      market3m,
      market15m,
    );
    if (scalpingAnalysis) analyses.push(scalpingAnalysis);

    // Day Trading Analysis (15m + 1h)
    const dayTradingAnalysis = this.analyzeDayTrading(
      coin,
      currentPrice,
      market15m,
      market1h,
    );
    if (dayTradingAnalysis) analyses.push(dayTradingAnalysis);

    // Swing Trading Analysis (1h + 4h)
    const swingTradingAnalysis = this.analyzeSwingTrading(
      coin,
      currentPrice,
      market1h,
      market4h,
    );
    if (swingTradingAnalysis) analyses.push(swingTradingAnalysis);

    // Position Trading Analysis (4h)
    const positionTradingAnalysis = this.analyzePositionTrading(
      coin,
      currentPrice,
      market4h,
    );
    if (positionTradingAnalysis) analyses.push(positionTradingAnalysis);

    return analyses.sort((a, b) => b.confidence - a.confidence);
  }

  private analyzeScalping(
    coin: string,
    currentPrice: number,
    market3m: MarketCondition,
    market15m: MarketCondition,
  ): StyleAnalysis | null {
    const reasons: string[] = [];
    let confidence = 0;
    let side: 'long' | 'short' | null = null;

    // Quick signals on 3m
    const last3mCandles = market3m.candles.slice(-3);
    const isUptrend3m = last3mCandles.every(
      (c, i) => i === 0 || c.close > last3mCandles[i - 1].close,
    );
    const isDowntrend3m = last3mCandles.every(
      (c, i) => i === 0 || c.close < last3mCandles[i - 1].close,
    );

    // Volume spike on 3m
    const lastVolume3m = market3m.volume;
    const avgVolume3m =
      market3m.candles.slice(-10).reduce((sum, c) => sum + c.volume, 0) / 10;

    // Initial signal from 3m
    if (isUptrend3m && lastVolume3m > avgVolume3m * 1.2) {
      confidence += 20;
      reasons.push('Strong 3m uptrend with volume');
      side = 'long';
    } else if (isDowntrend3m && lastVolume3m > avgVolume3m * 1.2) {
      confidence += 20;
      reasons.push('Strong 3m downtrend with volume');
      side = 'short';
    }

    // Confirmation from 15m trend
    if (side === 'long' && market15m.trend === 'bullish') {
      confidence += 20;
      reasons.push('Confirmed by 15m trend');
    } else if (side === 'short' && market15m.trend === 'bearish') {
      confidence += 20;
      reasons.push('Confirmed by 15m trend');
    }

    // RSI conditions
    if (market3m.rsi < 25 && market15m.rsi < 40) {
      confidence += 15;
      reasons.push('Oversold on both timeframes');
      side = 'long';
    } else if (market3m.rsi > 75 && market15m.rsi > 60) {
      confidence += 15;
      reasons.push('Overbought on both timeframes');
      side = 'short';
    }

    // Support/Resistance check with 15m confirmation
    const veryNearSupport = market3m.supports.some(
      (s) => Math.abs(s - currentPrice) / currentPrice < 0.003,
    );
    const veryNearResistance = market3m.resistances.some(
      (r) => Math.abs(r - currentPrice) / currentPrice < 0.003,
    );

    if (
      veryNearSupport &&
      market3m.macd.histogram > 0 &&
      market15m.trend === 'bullish'
    ) {
      confidence += 15;
      reasons.push('Price at immediate support with bullish confirmation');
      side = 'long';
    } else if (
      veryNearResistance &&
      market3m.macd.histogram < 0 &&
      market15m.trend === 'bearish'
    ) {
      confidence += 15;
      reasons.push('Price at immediate resistance with bearish confirmation');
      side = 'short';
    }

    // Add back BB calculation with 3m data
    const bb3m = TechnicalAnalysisUtil.calculateBollingerBands(
      market3m.candles.map((c) => c.close),
      20,
      2,
    );
    const bandwidth = (bb3m.upper - bb3m.lower) / bb3m.middle;

    if (confidence >= 50 && side) {
      const stopDistance = Math.min(0.002, bandwidth);
      return {
        style: 'Scalping',
        confidence,
        reasons,
        side,
        stopLoss:
          currentPrice *
          (side === 'long' ? 1 - stopDistance : 1 + stopDistance),
        takeProfit:
          currentPrice *
          (side === 'long' ? 1 + stopDistance * 2 : 1 - stopDistance * 2),
      };
    }

    return null;
  }

  private analyzeDayTrading(
    coin: string,
    currentPrice: number,
    market15m: MarketCondition,
    market1h: MarketCondition,
  ): StyleAnalysis | null {
    const reasons: string[] = [];
    let confidence = 0;
    let side: 'long' | 'short' | null = null;

    // Add Ichimoku Cloud analysis
    const ichimoku = TechnicalAnalysisUtil.calculateIchimokuCloud(
      market1h.candles,
    );
    if (
      currentPrice > ichimoku.leadingSpanA &&
      currentPrice > ichimoku.leadingSpanB
    ) {
      confidence += 15;
      reasons.push('Price above Ichimoku Cloud - bullish');
      side = 'long';
    } else if (
      currentPrice < ichimoku.leadingSpanA &&
      currentPrice < ichimoku.leadingSpanB
    ) {
      confidence += 15;
      reasons.push('Price below Ichimoku Cloud - bearish');
      side = 'short';
    }

    // Add Bollinger Bands for volatility
    const bb = TechnicalAnalysisUtil.calculateBollingerBands(
      market1h.candles.map((c) => c.close),
    );
    if (bb.bandwidth > 0.02) {
      confidence += 10;
      reasons.push('Good Bollinger Band width for day trading');
    }

    // Trend alignment between timeframes
    if (market15m.trend === market1h.trend && market15m.trend !== 'neutral') {
      confidence += 20;
      reasons.push(`Strong ${market15m.trend} trend on multiple timeframes`);
      side = market15m.trend === 'bullish' ? 'long' : 'short';
    }

    // RSI confirmation
    if (market1h.rsi < 30 && market15m.rsi < 35) {
      confidence += 15;
      reasons.push('Oversold on multiple timeframes');
      side = 'long';
    } else if (market1h.rsi > 70 && market15m.rsi > 65) {
      confidence += 15;
      reasons.push('Overbought on multiple timeframes');
      side = 'short';
    }

    // Volume and volatility check
    if (market15m.volatility !== 'low' && market1h.volatility !== 'low') {
      confidence += 15;
      reasons.push('Good intraday volatility');
    }

    if (confidence >= 50 && side) {
      return {
        style: 'Day Trading',
        confidence,
        reasons,
        side,
        stopLoss: currentPrice * (side === 'long' ? 0.99 : 1.01),
        takeProfit: currentPrice * (side === 'long' ? 1.03 : 0.97),
      };
    }

    return null;
  }

  private analyzeSwingTrading(
    coin: string,
    currentPrice: number,
    market1h: MarketCondition,
    market4h: MarketCondition,
  ): StyleAnalysis | null {
    const reasons: string[] = [];
    let confidence = 0;
    let side: 'long' | 'short' | null = null;

    // Add Ichimoku Cloud for trend strength
    const ichimoku = TechnicalAnalysisUtil.calculateIchimokuCloud(
      market4h.candles,
    );
    const cloudStrength =
      Math.abs(ichimoku.leadingSpanA - ichimoku.leadingSpanB) / currentPrice;

    if (cloudStrength > 0.02) {
      confidence += 15;
      if (ichimoku.leadingSpanA > ichimoku.leadingSpanB) {
        reasons.push('Strong bullish Ichimoku Cloud');
        side = 'long';
      } else {
        reasons.push('Strong bearish Ichimoku Cloud');
        side = 'short';
      }
    }

    // Add Bollinger Bands for trend confirmation
    const bb = TechnicalAnalysisUtil.calculateBollingerBands(
      market4h.candles.map((c) => c.close),
    );
    const trendStrength = (bb.upper - bb.lower) / bb.middle;
    if (trendStrength > 0.04) {
      confidence += 10;
      reasons.push('Strong trend confirmed by Bollinger Band width');
    }

    // Strong trend on higher timeframe
    if (market4h.trend !== 'neutral') {
      confidence += 20;
      reasons.push(`Strong ${market4h.trend} trend on 4h`);
      side = market4h.trend === 'bullish' ? 'long' : 'short';
    }

    // Support/Resistance levels
    const nearSupport = market4h.supports.some(
      (s) => Math.abs(s - currentPrice) / currentPrice < 0.02,
    );
    const nearResistance = market4h.resistances.some(
      (r) => Math.abs(r - currentPrice) / currentPrice < 0.02,
    );

    if (nearSupport && market4h.trend === 'bullish') {
      confidence += 20;
      reasons.push('Price near support level');
      side = 'long';
    } else if (nearResistance && market4h.trend === 'bearish') {
      confidence += 20;
      reasons.push('Price near resistance level');
      side = 'short';
    }

    // Momentum confirmation
    if (market4h.momentum > 0.05 && market1h.momentum > 0.02) {
      confidence += 15;
      reasons.push('Strong positive momentum');
      side = 'long';
    } else if (market4h.momentum < -0.05 && market1h.momentum < -0.02) {
      confidence += 15;
      reasons.push('Strong negative momentum');
      side = 'short';
    }

    if (confidence >= 50 && side) {
      return {
        style: 'Swing Trading',
        confidence,
        reasons,
        side,
        stopLoss: currentPrice * (side === 'long' ? 0.95 : 1.05),
        takeProfit: currentPrice * (side === 'long' ? 1.15 : 0.85),
      };
    }

    return null;
  }

  private analyzePositionTrading(
    coin: string,
    currentPrice: number,
    market4h: MarketCondition,
  ): StyleAnalysis | null {
    const reasons: string[] = [];
    let confidence = 0;
    let side: 'long' | 'short' | null = null;

    // Use Ichimoku Cloud for long-term trend
    const ichimoku = TechnicalAnalysisUtil.calculateIchimokuCloud(
      market4h.candles,
    );
    const isAboveCloud =
      currentPrice > Math.max(ichimoku.leadingSpanA, ichimoku.leadingSpanB);
    const isBelowCloud =
      currentPrice < Math.min(ichimoku.leadingSpanA, ichimoku.leadingSpanB);

    if (isAboveCloud && ichimoku.conversionLine > ichimoku.baseLine) {
      confidence += 20;
      reasons.push('Strong bullish Ichimoku setup');
      side = 'long';
    } else if (isBelowCloud && ichimoku.conversionLine < ichimoku.baseLine) {
      confidence += 20;
      reasons.push('Strong bearish Ichimoku setup');
      side = 'short';
    }

    // Use Bollinger Bands for trend strength
    const bb = TechnicalAnalysisUtil.calculateBollingerBands(
      market4h.candles.map((c) => c.close),
      50, // Longer period for position trading
    );
    if (currentPrice > bb.upper && side === 'long') {
      confidence += 15;
      reasons.push('Price above upper Bollinger Band - strong uptrend');
    } else if (currentPrice < bb.lower && side === 'short') {
      confidence += 15;
      reasons.push('Price below lower Bollinger Band - strong downtrend');
    }

    // Clear technical levels
    if (market4h.supports.length > 2 && market4h.resistances.length > 2) {
      confidence += 15;
      reasons.push('Clear technical levels established');
    }

    // RSI divergence
    const prices = market4h.candles.map((c) => c.close);
    const divergence = TechnicalAnalysisUtil.detectDivergence(
      prices,
      market4h.rsiValues,
    );
    if (divergence.bullish) {
      confidence += 20;
      reasons.push('Bullish RSI divergence on 4h');
      side = 'long';
    } else if (divergence.bearish) {
      confidence += 20;
      reasons.push('Bearish RSI divergence on 4h');
      side = 'short';
    }

    if (confidence >= 50 && side) {
      return {
        style: 'Position Trading',
        confidence,
        reasons,
        side,
        stopLoss: currentPrice * (side === 'long' ? 0.9 : 1.1),
        takeProfit: currentPrice * (side === 'long' ? 1.3 : 0.7),
      };
    }

    return null;
  }

  async analyzeTradeOpportunity(
    coin: string,
    style?: 'Scalping' | 'Day Trading' | 'Swing Trading' | 'Position Trading',
  ): Promise<TradingSignal | null> {
    try {
      const [candles3m, candles15m, candles1h, candles4h, currentPrice] =
        await Promise.all([
          this.historicalDataService.getCandles(coin, '3m', 100),
          this.historicalDataService.getCandles(coin, '15m', 100),
          this.historicalDataService.getCandles(coin, '1h', 100),
          this.historicalDataService.getCandles(coin, '4h', 100),
          this.getCurrentPrice(coin),
        ]);

      if (!currentPrice || candles3m.length < 50) {
        return null;
      }

      const market3m = this.calculateMarketCondition(candles3m);
      const market15m = this.calculateMarketCondition(candles15m);
      const market1h = this.calculateMarketCondition(candles1h);
      const market4h = this.calculateMarketCondition(candles4h);

      let styleAnalysis: StyleAnalysis | null;

      // Analyze specific style if provided, otherwise analyze all
      if (style) {
        switch (style) {
          case 'Scalping':
            styleAnalysis = this.analyzeScalping(
              coin,
              currentPrice,
              market3m,
              market15m,
            );
            break;
          case 'Day Trading':
            styleAnalysis = this.analyzeDayTrading(
              coin,
              currentPrice,
              market15m,
              market1h,
            );
            break;
          case 'Swing Trading':
            styleAnalysis = this.analyzeSwingTrading(
              coin,
              currentPrice,
              market1h,
              market4h,
            );
            break;
          case 'Position Trading':
            styleAnalysis = this.analyzePositionTrading(
              coin,
              currentPrice,
              market4h,
            );
            break;
        }
      } else {
        // Get the most promising style (highest confidence)
        const analyses = this.analyzeAllStyles(
          coin,
          currentPrice,
          market3m,
          market15m,
          market1h,
          market4h,
        );
        styleAnalysis = analyses[0];
      }

      if (styleAnalysis && styleAnalysis.confidence >= 60) {
        return {
          coin,
          side: styleAnalysis.side!,
          size: 1.0,
          entryPrice: currentPrice,
          stopLoss: styleAnalysis.stopLoss!,
          takeProfit: styleAnalysis.takeProfit!,
          confidence: styleAnalysis.confidence,
          reason: [
            `Strategy: ${styleAnalysis.style}`,
            ...styleAnalysis.reasons,
          ],
        };
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error analyzing trade opportunity for ${coin}:`,
        error,
      );
      return null;
    }
  }

  private async getCurrentPrice(coin: string): Promise<number | null> {
    try {
      // Check if we need to refresh prices
      if (Date.now() - this.lastPriceUpdate > this.PRICE_TTL) {
        this.cachedPrices = await this.getCurrentPrices();
        this.lastPriceUpdate = Date.now();
      }

      const price = this.cachedPrices.get(coin);
      if (!price) {
        this.logger.warn(`No price found for ${coin}`);
        return null;
      }

      return price;
    } catch (error) {
      this.logger.error(`Error fetching price for ${coin}:`, error);
      return null;
    }
  }

  private async getCurrentPrices(): Promise<Map<string, number>> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<Record<string, number>>(
          this.API_URL,
          { type: 'allMids' },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      return new Map(Object.entries(response.data));
    } catch (error) {
      this.logger.error('Failed to fetch current prices:', error);
      return new Map();
    }
  }
}
