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

@Injectable()
export class TraderAnalysisService {
  private readonly logger = new Logger(TraderAnalysisService.name);
  private readonly API_URL = 'https://api.hyperliquid.xyz/info';
  private readonly llm: ChatOpenAI;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly leaderboardService: LeaderboardService,
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

  private async getCurrentPrices(
    coins: string[],
  ): Promise<Map<string, number>> {
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

  private async generateAnalysis(
    address: string,
    accountSummary: AccountSummary,
    trades: Trade[],
    openOrders: OpenOrder[],
  ): Promise<string> {
    const metrics = this.calculateTradingMetrics(trades);

    // Get unique coins from positions, trades, and orders
    const uniqueCoins = new Set([
      ...accountSummary.assetPositions.map((p) => p.position.coin),
      ...trades.map((t) => t.coin),
      ...openOrders.map((o) => o.coin),
    ]);

    // Fetch current prices for all relevant coins
    const prices = await this.getCurrentPrices(Array.from(uniqueCoins));
    const positions = this.formatPositionData(accountSummary, prices);

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

    const prompt = `
      Analyze this trader's activity and risk management based on the following data:

      Account Overview:
      - Account Value: $${Number(accountSummary.marginSummary.accountValue).toFixed(2)}
      - Position Value: $${Number(accountSummary.marginSummary.totalNtlPos).toFixed(2)}
      - Margin Usage: ${((parseFloat(accountSummary.marginSummary.totalMarginUsed) / parseFloat(accountSummary.marginSummary.accountValue)) * 100).toFixed(2)}%

      Performance Summary:
      ${
        performanceData
          ? performanceData
          : `
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

      Most Traded:
      ${metrics.topTradedCoins
        .map((c) => {
          const currentPrice = prices.get(c.coin.toUpperCase()) || 0;
          return `- ${c.coin}: $${c.volume.toFixed(2)} vol, ${c.trades} trades, $${c.pnl.toFixed(2)} PnL (Now: $${Number(currentPrice).toFixed(2)})`;
        })
        .join('\n')}

      Current Positions:
      ${positions}

      Open Orders:
      ${openOrders
        .map((o) => {
          const currentPrice = prices.get(o.coin.toUpperCase()) || 0;
          const deviation =
            currentPrice > 0
              ? ((parseFloat(o.limitPx) - currentPrice) / currentPrice) * 100
              : 0;
          return `- ${o.side === 'B' ? 'Buy' : 'Sell'} ${o.coin}: ${o.sz} @ $${Number(o.limitPx).toFixed(2)} (${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}% from current)`;
        })
        .join('\n')}

      All Trades (sz=size, px=entry price, curr=current price, pnl=realized PnL, dir=direction, t=timestamp):
      ${formattedTrades
        .map(
          (t) =>
            `${t.t} | ${t.dir} | sz:${t.sz} | px:${t.px} | curr:${t.curr} | pnl:${t.pnl}`,
        )
        .join('\n')}

      Please analyze:
      1. Trading style and risk management
      2. Position sizing and leverage usage
      3. Performance trends across timeframes
      4. Notable strengths and risks
      5. Overall sophistication level

      Keep it concise but informative.
    `;

    const response = await this.llm.invoke(prompt);
    return response.content as string;
  }
}
