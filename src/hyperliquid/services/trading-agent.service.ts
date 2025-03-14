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
    };
  }

  async analyzeTradeOpportunity(coin: string): Promise<TradingSignal | null> {
    try {
      // Get market data
      const [candles, currentPrice] = await Promise.all([
        this.historicalDataService.getCandles(coin, '15m', 100),
        this.getCurrentPrice(coin),
      ]);

      if (!currentPrice || candles.length < 50) {
        return null;
      }

      const marketCondition = this.calculateMarketCondition(candles);
      // console.log(marketCondition);
      const signal = this.generateTradingSignal(
        coin,
        currentPrice,
        marketCondition,
      );

      return signal;
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

  private generateTradingSignal(
    coin: string,
    currentPrice: number,
    market: MarketCondition,
  ): TradingSignal | null {
    try {
      const reasons: string[] = [];
      let confidence = 0;

      const prices = market.candles.map((c) => c.close);
      const bb: BollingerBands =
        TechnicalAnalysisUtil.calculateBollingerBands(prices);

      const ichimoku: IchimokuCloud =
        TechnicalAnalysisUtil.calculateIchimokuCloud(market.candles);
      const divergence = TechnicalAnalysisUtil.detectDivergence(
        prices,
        market.rsiValues,
      );
      const volumeTrend = TechnicalAnalysisUtil.detectVolumeTrend(
        market.candles,
      );

      if (!bb || !ichimoku || !divergence || !volumeTrend) {
        this.logger.warn(`Invalid technical analysis results for ${coin}`);
        return null;
      }

      // Price near Bollinger Band extremes
      if (currentPrice <= bb.lower) {
        confidence += 15;
        reasons.push('Price at/below lower Bollinger Band');
      } else if (currentPrice >= bb.upper) {
        confidence += 15;
        reasons.push('Price at/above upper Bollinger Band');
      }

      // Ichimoku Cloud signals
      if (
        currentPrice > ichimoku.leadingSpanA &&
        currentPrice > ichimoku.leadingSpanB
      ) {
        confidence += 10;
        reasons.push('Price above Ichimoku Cloud');
      } else if (
        currentPrice < ichimoku.leadingSpanA &&
        currentPrice < ichimoku.leadingSpanB
      ) {
        confidence += 10;
        reasons.push('Price below Ichimoku Cloud');
      }

      // RSI Divergence
      if (divergence.bullish) {
        confidence += 20;
        reasons.push('Bullish RSI divergence detected');
      } else if (divergence.bearish) {
        confidence += 20;
        reasons.push('Bearish RSI divergence detected');
      }

      // Volume confirmation
      if (volumeTrend === 'increasing') {
        confidence += 15;
        reasons.push('Increasing volume trend');
      }

      // Trend following strategy
      if (market.trend === 'bullish') {
        confidence += 20;
        reasons.push('Bullish trend (EMA20 > EMA50)');
      } else if (market.trend === 'bearish') {
        confidence += 20;
        reasons.push('Bearish trend (EMA20 < EMA50)');
      }

      // RSI conditions
      if (market.rsi < 30) {
        confidence += 15;
        reasons.push('Oversold conditions (RSI < 30)');
      } else if (market.rsi > 70) {
        confidence += 15;
        reasons.push('Overbought conditions (RSI > 70)');
      }

      // MACD signals
      if (
        market.macd.histogram > 0 &&
        market.macd.histogram > market.macd.histogram
      ) {
        confidence += 15;
        reasons.push('Positive MACD momentum');
      } else if (
        market.macd.histogram < 0 &&
        market.macd.histogram < market.macd.histogram
      ) {
        confidence += 15;
        reasons.push('Negative MACD momentum');
      }

      // Support/Resistance proximity
      const nearestSupport = market.supports.reduce((prev, curr) =>
        Math.abs(curr - currentPrice) < Math.abs(prev - currentPrice)
          ? curr
          : prev,
      );
      const nearestResistance = market.resistances.reduce((prev, curr) =>
        Math.abs(curr - currentPrice) < Math.abs(prev - currentPrice)
          ? curr
          : prev,
      );

      const supportDistance = (currentPrice - nearestSupport) / currentPrice;
      const resistanceDistance =
        (nearestResistance - currentPrice) / currentPrice;

      console.log(coin, confidence, reasons);

      // Generate signal only if confidence is high enough
      if (confidence >= 60) {
        const side = this.determineTradeSide(
          market,
          bb,
          ichimoku,
          divergence,
          volumeTrend,
        );
        const stopDistance =
          side === 'long' ? supportDistance : resistanceDistance;
        const profitDistance = stopDistance * 2; // 2:1 reward-to-risk ratio

        return {
          coin,
          side,
          size: 1.0, // Base position size
          entryPrice: currentPrice,
          stopLoss:
            side === 'long'
              ? currentPrice * (1 - stopDistance)
              : currentPrice * (1 + stopDistance),
          takeProfit:
            side === 'long'
              ? currentPrice * (1 + profitDistance)
              : currentPrice * (1 - profitDistance),
          confidence,
          reason: reasons,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error generating trading signal for ${coin}:`, error);
      return null;
    }
  }

  private determineTradeSide(
    market: MarketCondition,
    bb: BollingerBands,
    ichimoku: IchimokuCloud,
    divergence: { bullish: boolean; bearish: boolean },
    volumeTrend: string,
  ): 'long' | 'short' {
    let bullishSignals = 0;
    let bearishSignals = 0;

    // Count bullish signals
    if (market.trend === 'bullish') bullishSignals += 2;
    if (divergence.bullish) bullishSignals += 2;
    if (market.rsi < 30) bullishSignals++;
    if (market.macd.histogram > 0) bullishSignals++;
    if (volumeTrend === 'increasing') bullishSignals++;

    // Count bearish signals
    if (market.trend === 'bearish') bearishSignals += 2;
    if (divergence.bearish) bearishSignals += 2;
    if (market.rsi > 70) bearishSignals++;
    if (market.macd.histogram < 0) bearishSignals++;
    if (volumeTrend === 'decreasing') bearishSignals++;

    return bullishSignals > bearishSignals ? 'long' : 'short';
  }
}
