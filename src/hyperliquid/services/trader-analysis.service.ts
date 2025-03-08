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
  totalPnL: number;
  winRate: number;
  avgTradeSize: number;
  topTradedCoins: Array<{ coin: string; volume: number }>;
  recentPerformance: {
    trades: number;
    pnl: number;
    volume: number;
  };
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

  private calculateTradingMetrics(fills: Fill[]): TradingMetrics {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Calculate volume and PnL by coin
    const coinStats = fills.reduce(
      (acc, fill) => {
        const coin = fill.coin;
        if (!acc[coin]) {
          acc[coin] = { volume: 0, trades: 0 };
        }
        acc[coin].volume += Math.abs(parseFloat(fill.sz));
        acc[coin].trades += 1;
        return acc;
      },
      {} as Record<string, { volume: number; trades: number }>,
    );

    // Get top traded coins
    const topTradedCoins = Object.entries(coinStats)
      .map(([coin, stats]) => ({ coin, volume: stats.volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    // Calculate win rate and other metrics
    const profitableTrades = fills.filter(
      (f) => parseFloat(f.closedPnl) > 0,
    ).length;
    const recentFills = fills.filter((f) => f.time > dayAgo);

    return {
      totalTrades: fills.length,
      totalVolume: fills.reduce(
        (sum, f) => sum + Math.abs(parseFloat(f.sz)),
        0,
      ),
      totalPnL: fills.reduce((sum, f) => sum + parseFloat(f.closedPnl), 0),
      winRate: (profitableTrades / fills.length) * 100,
      avgTradeSize:
        fills.reduce((sum, f) => sum + Math.abs(parseFloat(f.sz)), 0) /
        fills.length,
      topTradedCoins,
      recentPerformance: {
        trades: recentFills.length,
        pnl: recentFills.reduce((sum, f) => sum + parseFloat(f.closedPnl), 0),
        volume: recentFills.reduce(
          (sum, f) => sum + Math.abs(parseFloat(f.sz)),
          0,
        ),
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

      const analysis = await this.generateAnalysis(
        accountSummary,
        fills,
        openOrders,
      );

      return {
        address,
        accountSummary,
        recentFills: fills,
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
    fills: Fill[],
    openOrders: OpenOrder[],
  ): Promise<string> {
    const metrics = this.calculateTradingMetrics(fills);
    const positions = this.formatPositionData(accountSummary);

    const prompt = `
      Analyze this trader's activity and risk management based on the following data:

      Account Overview:
      - Total Account Value: ${accountSummary.marginSummary.accountValue} USD
      - Total Position Value: ${accountSummary.marginSummary.totalNtlPos} USD
      - Margin Utilization: ${((parseFloat(accountSummary.marginSummary.totalMarginUsed) / parseFloat(accountSummary.marginSummary.accountValue)) * 100).toFixed(2)}%

      Trading Performance:
      - Total Trades: ${metrics.totalTrades}
      - Win Rate: ${metrics.winRate.toFixed(2)}%
      - Total PnL: ${metrics.totalPnL.toFixed(2)} USD
      - Average Trade Size: ${metrics.avgTradeSize.toFixed(2)} USD
      
      Last 24h Performance:
      - Trades: ${metrics.recentPerformance.trades}
      - PnL: ${metrics.recentPerformance.pnl.toFixed(2)} USD
      - Volume: ${metrics.recentPerformance.volume.toFixed(2)} USD

      Most Traded Assets:
      ${metrics.topTradedCoins.map((c) => `- ${c.coin}: ${c.volume.toFixed(2)} USD volume`).join('\n')}

      Current Positions:
      ${positions}

      Open Orders:
      ${openOrders
        .map(
          (o) =>
            `- ${o.side === 'B' ? 'Buy' : 'Sell'} ${o.coin}: ${o.sz} @ ${o.limitPx}`,
        )
        .join('\n')}

      Please provide a comprehensive analysis of:
      1. Trading style and risk management approach
      2. Position sizing and leverage usage patterns
      3. Recent performance and market timing
      4. Notable strengths and potential risks
      5. Overall trading sophistication level

      Keep the analysis concise but informative.
    `;

    const response = await this.llm.invoke(prompt);
    return response.content as string;
  }
}
