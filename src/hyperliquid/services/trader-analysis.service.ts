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
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-3.5-turbo',
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

  private formatPositionData(accountSummary: AccountSummary): string {
    return accountSummary.assetPositions
      .map((p) => {
        const pos = p.position;
        const risk =
          (parseFloat(pos.marginUsed) /
            parseFloat(accountSummary.marginSummary.accountValue)) *
          100;
        return `
          ${pos.coin}:
          - Size: ${pos.szi} (${risk.toFixed(2)}% of account)
          - Entry: ${pos.entryPx}
          - Leverage: ${pos.leverage.value}x (${pos.leverage.type})
          - PnL: ${pos.unrealizedPnl} (ROE: ${pos.returnOnEquity}%)
          - Liquidation Price: ${pos.liquidationPx}`;
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
    return response.data;
  }

  private async getRecentFills(address: string): Promise<Fill[]> {
    const response = await firstValueFrom(
      this.httpService.post(this.API_URL, {
        type: 'userFills',
        user: address,
      }),
    );
    return response.data;
  }

  private async getOpenOrders(address: string): Promise<OpenOrder[]> {
    const response = await firstValueFrom(
      this.httpService.post(this.API_URL, {
        type: 'openOrders',
        user: address,
      }),
    );
    return response.data;
  }

  private async generateAnalysis(
    accountSummary: AccountSummary,
    trades: Trade[],
    openOrders: OpenOrder[],
  ): Promise<string> {
    const metrics = this.calculateTradingMetrics(trades);
    const positions = this.formatPositionData(accountSummary);

    // Format trades with minimal fields
    const formattedTrades = trades.map((t) => ({
      sz: t.totalSize.toFixed(3),
      px: t.avgPrice.toFixed(2),
      pnl: t.closedPnl?.toFixed(2) ?? '',
      dir: t.side,
      t: new Date(t.time).toISOString(),
    }));

    const prompt = `
      Analyze this trader's activity and risk management based on the following data:

      Account Overview:
      - Total Account Value: ${accountSummary.marginSummary.accountValue} USD
      - Total Position Value: ${accountSummary.marginSummary.totalNtlPos} USD
      - Margin Utilization: ${((parseFloat(accountSummary.marginSummary.totalMarginUsed) / parseFloat(accountSummary.marginSummary.accountValue)) * 100).toFixed(2)}%

      Trading Performance:
      - Total Trades: ${metrics.totalTrades}
      - Win Rate: ${metrics.winRate.toFixed(2)}%
      - Total PnL: ${metrics.totalClosedPnL.toFixed(2)} USD
      - Average Trade Size: ${metrics.avgTradeSize.toFixed(2)} USD
      
      Last 24h Performance:
      - Trades: ${metrics.recentPerformance.trades}
      - PnL: ${metrics.recentPerformance.closedPnl.toFixed(2)} USD
      - Volume: ${metrics.recentPerformance.volume.toFixed(2)} USD

      Most Traded Assets:
      ${metrics.topTradedCoins
        .map(
          (c) =>
            `- ${c.coin}: ${c.volume.toFixed(2)} USD volume, ${c.trades} trades, ${c.pnl.toFixed(2)} USD PnL`,
        )
        .join('\n')}

      Current Positions:
      ${positions}

      Open Orders:
      ${openOrders
        .map(
          (o) =>
            `- ${o.side === 'B' ? 'Buy' : 'Sell'} ${o.coin}: ${o.sz} @ ${o.limitPx}`,
        )
        .join('\n')}

      All Trades (sz=size, px=price, pnl=realized PnL, dir=direction, t=timestamp):
      ${formattedTrades
        .map(
          (t) => `${t.t} | ${t.dir} | sz:${t.sz} | px:${t.px} | pnl:${t.pnl}`,
        )
        .join('\n')}

      Please provide a comprehensive analysis of:
      1. Trading style and risk management approach
      2. Position sizing and leverage usage patterns (Only for current positions)
      3. Recent performance and market timing
      4. Notable strengths and potential risks
      5. Overall trading sophistication level

      Keep the analysis concise but informative.
    `;

    const response = await this.llm.invoke(prompt);
    return response.content as string;
  }
}
