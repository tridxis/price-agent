import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { firstValueFrom } from 'rxjs';
import {
  AccountSummary,
  Fill,
  OpenOrder,
  TraderAnalysis,
} from '../types/trader.type';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardRow } from '../types/leaderboard.type';
import { HistoricalDataService } from '../../shared/services/historical-data.service';
import { Candle } from 'src/shared';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  TechnicalAnalysisUtil,
  MACD,
  SupportResistance,
} from '../utils/technical-analysis.util';

interface TradingMetrics {
  totalTrades: number;
  totalVolume: number;
  totalClosedPnL: number;
  winRate: number;
  avgTradeSize: number;
  topTradedCoins: Array<{
    coin: string;
    volume: number;
    trades: number;
    pnl: number;
  }>;
  recentPerformance: {
    trades: number;
    closedTrades: number;
    closedPnl: number;
    volume: number;
  };
}

interface Trade {
  coin: string;
  side: string;
  totalSize: number;
  avgPrice: number;
  closedPnl?: number;
  time: number;
  // fills: Fill[];
}

interface OrderAnalysis {
  deviation: number;
  rsi: number;
  macd: {
    value: number;
    signal: number;
    histogram: number;
  };
  nearestSupport: number;
  nearestResistance: number;
  recommendation: 'strong' | 'moderate' | 'weak' | 'risky';
}

@Injectable()
export class TraderAnalysisService {
  private readonly logger = new Logger(TraderAnalysisService.name);
  private readonly API_URL = 'https://api.hyperliquid.xyz/info';
  private readonly llm: ChatOpenAI;
  private readonly candleCache: Map<
    string,
    {
      data: Candle[];
      timestamp: number;
    }
  > = new Map();
  private readonly CANDLE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly leaderboardService: LeaderboardService,
    private readonly historicalDataService: HistoricalDataService,
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o-mini',
      temperature: 0.7,
    });
  }

  private combineFillsToTrades(fills: Fill[]): Trade[] {
    // Sort fills by time to group them properly
    const sortedFills = [...fills].sort((a, b) => a.time - b.time);

    // Group fills by coin + dir + hasClosedPnl
    const tradeGroups = new Map<string, Fill[]>();

    for (const fill of sortedFills) {
      const hasClosedPnl =
        fill.closedPnl !== undefined && fill.closedPnl !== null;
      const key = `${fill.coin}-${fill.dir}-${hasClosedPnl}`;

      if (!tradeGroups.has(key)) {
        tradeGroups.set(key, []);
      }
      tradeGroups.get(key)?.push(fill);
    }

    // Convert groups to trades
    const trades: Trade[] = [];

    for (const fills of tradeGroups.values()) {
      if (fills.length === 0) continue;

      const firstFill = fills[0];
      const totalSize = fills.reduce(
        (sum, f) => sum + Math.abs(parseFloat(f.sz)),
        0,
      );
      const weightedPrice = fills.reduce(
        (sum, f) => sum + Math.abs(parseFloat(f.sz)) * parseFloat(f.px),
        0,
      );

      trades.push({
        coin: firstFill.coin,
        side: firstFill.dir,
        totalSize,
        avgPrice: weightedPrice / totalSize,
        closedPnl:
          firstFill.closedPnl !== undefined
            ? fills.reduce((sum, f) => sum + parseFloat(f.closedPnl || '0'), 0)
            : undefined,
        time: firstFill.time,
        // fills: fills,
      });
    }

    // Sort trades by time
    return trades.sort((a, b) => b.time - a.time);
  }

  private calculateTradingMetrics(trades: Trade[]): TradingMetrics {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Filter closed trades
    const closedTrades = trades.filter((t) => t.closedPnl !== undefined);

    // Calculate volume and PnL by coin
    const coinStats = trades.reduce(
      (acc, trade) => {
        const coin = trade.coin;
        if (!acc[coin]) {
          acc[coin] = { volume: 0, trades: 0, closedPnl: 0 };
        }
        acc[coin].volume += trade.totalSize;
        acc[coin].trades += 1;
        if (trade.closedPnl) {
          acc[coin].closedPnl += trade.closedPnl;
        }
        return acc;
      },
      {} as Record<
        string,
        { volume: number; trades: number; closedPnl: number }
      >,
    );

    // Rest of the metrics calculation using trades instead of fills
    const profitableTrades = closedTrades.filter(
      (t) => (t.closedPnl || 0) >= 0,
    ).length;
    const winRate =
      closedTrades.length > 0
        ? (profitableTrades / closedTrades.length) * 100
        : 0;

    const recentTrades = trades.filter((t) => t.time > dayAgo);
    const recentClosedTrades = recentTrades.filter(
      (t) => t.closedPnl !== undefined,
    );

    return {
      totalTrades: trades.length,
      totalVolume: trades.reduce((sum, t) => sum + t.totalSize, 0),
      totalClosedPnL: closedTrades.reduce(
        (sum, t) => sum + (t.closedPnl || 0),
        0,
      ),
      winRate,
      avgTradeSize:
        trades.reduce((sum, t) => sum + t.totalSize, 0) / trades.length,
      topTradedCoins: Object.entries(coinStats)
        .map(([coin, stats]) => ({
          coin,
          volume: stats.volume,
          trades: stats.trades,
          pnl: stats.closedPnl,
        }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5),
      recentPerformance: {
        trades: recentTrades.length,
        closedTrades: recentClosedTrades.length,
        closedPnl: recentClosedTrades.reduce(
          (sum, t) => sum + (t.closedPnl || 0),
          0,
        ),
        volume: recentTrades.reduce((sum, t) => sum + t.totalSize, 0),
      },
    };
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

  private formatPositionData(
    accountSummary: AccountSummary,
    prices: Map<string, number>,
  ): string {
    return accountSummary.assetPositions
      .map((p) => {
        const pos = p.position;
        const currentPrice = prices.get(pos.coin.toUpperCase()) || 0;
        const risk =
          (parseFloat(pos.marginUsed) /
            parseFloat(accountSummary.marginSummary.accountValue)) *
          100;
        const priceChange =
          currentPrice > 0
            ? ((currentPrice - parseFloat(pos.entryPx)) /
                parseFloat(pos.entryPx)) *
              100
            : 0;

        return `
          ${pos.coin}:
          - Size: ${pos.szi} (${risk.toFixed(2)}% of account)
          - Entry: ${pos.entryPx}
          - Current: ${Number(currentPrice).toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)
          - Leverage: ${pos.leverage.value}x (${pos.leverage.type})
          - PnL: ${pos.unrealizedPnl} (ROE: ${pos.returnOnEquity}%)
          - Liquidation Price: ${pos.liquidationPx}`;
      })
      .join('\n');
  }

  private formatPerformanceData(trader: LeaderboardRow): string {
    return trader.windowPerformances
      .map(([window, perf]) => {
        const windowName = window.charAt(0).toUpperCase() + window.slice(1);
        return `
        ${windowName} Performance:
        - PnL: $${Number(perf.pnl).toFixed(2)}
        - ROI: ${(parseFloat(perf.roi) * 100).toFixed(2)}%
        - Vol: $${Number(perf.vlm).toFixed(2)}`;
      })
      .join('\n');
  }

  async analyzeTrader(address: string): Promise<TraderAnalysis> {
    try {
      const [accountSummary, fills, openOrders] = await Promise.all([
        this.getAccountSummary(address),
        this.getRecentFills(address),
        this.getOpenOrders(address),
      ]);

      // Combine fills into trades
      const trades = this.combineFillsToTrades(fills);

      const analysis = await this.generateAnalysis(
        address,
        accountSummary,
        trades,
        openOrders,
      );

      return {
        address,
        accountSummary,
        recentTrades: trades,
        openOrders,
        analysis,
      };
    } catch (error) {
      this.logger.error(`Error analyzing trader ${address}:`, error);
      throw error;
    }
  }

  private async getAccountSummary(address: string): Promise<AccountSummary> {
    const response = await firstValueFrom(
      this.httpService.post(this.API_URL, {
        type: 'clearinghouseState',
        user: address,
      }),
    );
    return response.data as AccountSummary;
  }

  private async getRecentFills(address: string): Promise<Fill[]> {
    const response = await firstValueFrom(
      this.httpService.post(this.API_URL, {
        type: 'userFills',
        user: address,
      }),
    );
    return response.data as Fill[];
  }

  private async getOpenOrders(address: string): Promise<OpenOrder[]> {
    const response = await firstValueFrom(
      this.httpService.post(this.API_URL, {
        type: 'openOrders',
        user: address,
      }),
    );
    return response.data as OpenOrder[];
  }

  private analyzeData(
    data: {
      px: string;
      sz: string;
    },
    currentPrice: number,
    candles: Candle[],
  ): OrderAnalysis {
    if (candles.length === 0) {
      return {
        deviation: 0,
        rsi: 50,
        macd: { value: 0, signal: 0, histogram: 0 },
        nearestSupport: currentPrice * 0.99,
        nearestResistance: currentPrice * 1.01,
        recommendation: 'moderate',
      };
    }

    const prices = candles.map((c) => c.close);
    const rsi = TechnicalAnalysisUtil.calculateRSI(prices);
    const macd = TechnicalAnalysisUtil.calculateMACD(prices);
    const { supports, resistances } =
      TechnicalAnalysisUtil.findSupportResistance(candles);

    const orderPrice = parseFloat(data.px);
    const deviation = ((orderPrice - currentPrice) / currentPrice) * 100;

    // Find nearest levels with default values
    const nearestSupport =
      supports.length > 0
        ? supports.reduce(
            (prev, curr) =>
              Math.abs(curr - orderPrice) < Math.abs(prev - orderPrice)
                ? curr
                : prev,
            supports[0],
          )
        : currentPrice * 0.99;

    const nearestResistance =
      resistances.length > 0
        ? resistances.reduce(
            (prev, curr) =>
              Math.abs(curr - orderPrice) < Math.abs(prev - orderPrice)
                ? curr
                : prev,
            resistances[0],
          )
        : currentPrice * 1.01;

    // Determine recommendation based on technical analysis
    let recommendation: 'strong' | 'moderate' | 'weak' | 'risky' = 'moderate';

    // Check if price is near support/resistance
    const nearSupport =
      Math.abs(currentPrice - nearestSupport) / currentPrice < 0.02;
    const nearResistance =
      Math.abs(currentPrice - nearestResistance) / currentPrice < 0.02;

    // Analyze order based on technical indicators
    if (Number(data.sz) > 0) {
      // Buy order
      if (rsi < 30 && macd.histogram > 0 && nearSupport) {
        recommendation = 'strong';
      } else if (rsi > 70 || (nearResistance && macd.histogram < 0)) {
        recommendation = 'risky';
      } else if (macd.histogram > 0) {
        recommendation = 'moderate';
      } else {
        recommendation = 'weak';
      }
    } else {
      // Sell order
      if (rsi > 70 && macd.histogram < 0 && nearResistance) {
        recommendation = 'strong';
      } else if (rsi < 30 || (nearSupport && macd.histogram > 0)) {
        recommendation = 'risky';
      } else if (macd.histogram < 0) {
        recommendation = 'moderate';
      } else {
        recommendation = 'weak';
      }
    }

    return {
      deviation,
      rsi,
      macd,
      nearestSupport,
      nearestResistance,
      recommendation,
    };
  }

  private async getCachedCandles(
    coin: string,
    interval: string,
    limit: number,
  ): Promise<Candle[]> {
    const cacheKey = `${coin}-${interval}-${limit}`;
    const cached = this.candleCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CANDLE_CACHE_TTL) {
      return cached.data;
    }

    const candles = await this.historicalDataService.getCandles(
      coin,
      interval,
      limit,
    );
    this.candleCache.set(cacheKey, {
      data: candles,
      timestamp: now,
    });

    return candles;
  }

  private async generateAnalysis(
    address: string,
    accountSummary: AccountSummary,
    trades: Trade[],
    openOrders: OpenOrder[],
  ): Promise<string> {
    console.log('Generating analysis for trader:', address);
    const metrics = this.calculateTradingMetrics(trades);

    // Get unique coins from positions, trades, and orders
    const uniqueCoins = new Set([
      ...accountSummary.assetPositions.map((p) => p.position.coin),
      ...openOrders.map((o) => o.coin),
    ]);

    // Fetch current prices for all relevant coins
    const prices = await this.getCurrentPrices();
    // const positions = this.formatPositionData(accountSummary, prices);

    // Get leaderboard data for this trader
    const trader = this.leaderboardService.getTraderByAddress(address);
    const performanceData = trader
      ? this.formatPerformanceData(trader)
      : undefined;

    // Format trades with minimal fields and include price impact
    const formattedTrades = trades.map((t) => {
      const currentPrice = prices.get(t.coin.toUpperCase()) || 0;
      const priceChange =
        currentPrice > 0 ? ((currentPrice - t.avgPrice) / t.avgPrice) * 100 : 0;

      return {
        sz: t.totalSize.toFixed(3),
        px: t.avgPrice.toFixed(2),
        curr:
          currentPrice > 0
            ? `${Number(currentPrice).toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%)`
            : 'N/A',
        pnl: t.closedPnl?.toFixed(2) ?? '',
        dir: t.side,
        t: new Date(t.time).toISOString(),
      };
    });

    // Fetch candles for all coins at once
    const uniqueCoinsArray = Array.from(uniqueCoins);
    const candlesPromises = uniqueCoinsArray.map((coin) =>
      this.getCachedCandles(coin, '15m', 100),
    );
    const allCandles = await Promise.all(candlesPromises);
    const candlesByCoin = new Map(
      uniqueCoinsArray.map((coin, i) => [coin, allCandles[i]]),
    );

    // Analyze each open order using cached candles
    const orderAnalyses = await Promise.all(
      openOrders.map((order) => {
        const currentPrice = prices.get(order.coin.toUpperCase()) || 0;
        const candles = candlesByCoin.get(order.coin) || [];
        return this.analyzeData(
          {
            px: order.limitPx,
            sz: order.sz,
          },
          currentPrice,
          candles,
        );
      }),
    );

    const prompt = `
      Analyze this trader's activity and risk management based on the following data:

      Account Overview:
      - Account Value: $${Number(accountSummary.marginSummary.accountValue).toFixed(2)}
      - Position Value: $${Number(accountSummary.marginSummary.totalNtlPos).toFixed(2)}
      - Margin Usage: ${((parseFloat(accountSummary.marginSummary.totalMarginUsed) / parseFloat(accountSummary.marginSummary.accountValue)) * 100).toFixed(2)}%

      Performance Summary:
      ${
        performanceData ??
        `
      - Total Trades: ${metrics.totalTrades}
      - Win Rate: ${metrics.winRate.toFixed(2)}%
      - Total PnL: $${metrics.totalClosedPnL.toFixed(2)}
      - Avg Trade Size: $${metrics.avgTradeSize.toFixed(2)}
      
      Last 24h:
      - Trades: ${metrics.recentPerformance.trades}
      - PnL: $${metrics.recentPerformance.closedPnl.toFixed(2)}
      - Vol: $${metrics.recentPerformance.volume.toFixed(2)}
      `
      }

      Active Positions Analysis:
      ${accountSummary.assetPositions
        .map((p) => {
          const pos = p.position;
          const currentPrice = Number(prices.get(pos.coin.toUpperCase()) || 0);
          const candles = candlesByCoin.get(pos.coin) || [];
          const analysis = this.analyzeData(
            {
              px: pos.entryPx,
              sz: pos.szi,
            },
            currentPrice,
            candles,
          );

          return `
        ${pos.coin} (${Number(pos.szi) > 0 ? 'Long' : 'Short'}):
        - Size: ${pos.szi} (${((parseFloat(pos.marginUsed) / parseFloat(accountSummary.marginSummary.accountValue)) * 100).toFixed(2)}% of account)
        - Entry: $${Number(pos.entryPx).toFixed(2)} | Current: $${currentPrice.toFixed(2)} (${analysis.deviation >= 0 ? '+' : ''}${analysis.deviation.toFixed(2)}%)
        - Leverage: ${pos.leverage.value}x ${pos.leverage.type}
        - PnL: $${Number(pos.unrealizedPnl).toFixed(2)} (ROE: ${Number(pos.returnOnEquity).toFixed(2)}%)
        - Technical Indicators:
          * RSI: ${analysis.rsi.toFixed(2)} (${analysis.rsi > 70 ? 'Overbought' : analysis.rsi < 30 ? 'Oversold' : 'Neutral'})
          * MACD: ${analysis.macd.histogram > 0 ? 'Bullish' : 'Bearish'} (${analysis.macd.histogram.toFixed(4)})
        - Key Levels:
          * Support: $${analysis.nearestSupport.toFixed(2)} (${(((analysis.nearestSupport - currentPrice) / currentPrice) * 100).toFixed(2)}% away)
          * Resistance: $${analysis.nearestResistance.toFixed(2)} (${(((analysis.nearestResistance - currentPrice) / currentPrice) * 100).toFixed(2)}% away)
          * Liquidation: $${Number(pos.liquidationPx).toFixed(2)} (${(((Number(pos.liquidationPx) - currentPrice) / currentPrice) * 100).toFixed(2)}% away)
        - Position Status: ${analysis.recommendation.toUpperCase()}
        `;
        })
        .join('\n')}

      Pending Orders Analysis:
      ${openOrders
        .map((o, i) => {
          const analysis = orderAnalyses[i];
          const currentPrice = Number(prices.get(o.coin.toUpperCase()) || 0);
          return `
        ${Number(o.sz) > 0 ? 'Buy' : 'Sell'} ${o.coin}:
        - Size: ${o.sz} @ $${Number(o.limitPx).toFixed(2)} (${analysis.deviation >= 0 ? '+' : ''}${analysis.deviation.toFixed(2)}% from market)
        - Market Context:
          * Current Price: $${currentPrice.toFixed(2)}
          * RSI: ${analysis.rsi.toFixed(2)} (${analysis.rsi > 70 ? 'Overbought' : analysis.rsi < 30 ? 'Oversold' : 'Neutral'})
          * MACD Trend: ${analysis.macd.histogram > 0 ? 'Bullish' : 'Bearish'} (Strength: ${Math.abs(analysis.macd.histogram).toFixed(4)})
        - Price Levels:
          * Nearest Support: $${analysis.nearestSupport.toFixed(2)} (${(((analysis.nearestSupport - currentPrice) / currentPrice) * 100).toFixed(2)}% from current)
          * Nearest Resistance: $${analysis.nearestResistance.toFixed(2)} (${(((analysis.nearestResistance - currentPrice) / currentPrice) * 100).toFixed(2)}% from current)
        - Order Quality: ${analysis.recommendation.toUpperCase()}
        `;
        })
        .join('\n')}

      Recent Trading Activity:
      ${formattedTrades
        .slice(0, 5)
        .map(
          (t) =>
            `${t.t} | ${t.dir} | sz:${t.sz} | px:${t.px} | curr:${t.curr} | pnl:${t.pnl}`,
        )
        .join('\n')}

      Please analyze:
      1. Trading style and risk management
      2. Performance trends across timeframes
      3. Position management and risk exposure
      4. Order placement strategy and technical timing
      5. Risk/reward setup for current positions
      6. Market positioning and directional bias
      7. Notable strengths and risks
      8. Overall trading sophistication

      Focus on technical analysis and risk management. Keep it concise but informative.
    `;

    const response = await this.llm.invoke(prompt);

    console.log(response.content);

    return response.content as string;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  private cleanupCandleCache(): void {
    const now = Date.now();
    for (const [key, value] of this.candleCache.entries()) {
      if (now - value.timestamp > this.CANDLE_CACHE_TTL) {
        this.candleCache.delete(key);
      }
    }
  }
}
