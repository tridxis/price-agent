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
    const prompt = `
      Analyze this trader's activity and risk management based on the following data:

      Account Summary:
      - Total Account Value: ${accountSummary.marginSummary.accountValue} USD
      - Total Position Value: ${accountSummary.marginSummary.totalNtlPos} USD
      - Margin Used: ${accountSummary.marginSummary.totalMarginUsed} USD
      
      Active Positions:
      ${accountSummary.assetPositions
        .map(
          (p) => `
        - ${p.position.coin}: Size ${p.position.szi}, Entry ${p.position.entryPx}
        - Leverage: ${p.position.leverage.value}x (${p.position.leverage.type})
        - Unrealized PnL: ${p.position.unrealizedPnl}
        - ROE: ${p.position.returnOnEquity}
      `,
        )
        .join('\n')}

      Recent Trading Activity (Last ${fills.length} trades):
      ${fills
        .slice(0, 5)
        .map(
          (f) => `
        - ${f.dir} ${f.coin} | Size: ${f.sz} | Price: ${f.px}
        - PnL: ${f.closedPnl} | Time: ${new Date(f.time).toISOString()}
      `,
        )
        .join('\n')}

      Current Open Orders:
      ${openOrders
        .map(
          (o) => `
        - ${o.side === 'B' ? 'Buy' : 'Sell'} ${o.coin} | Size: ${o.sz} | Price: ${o.limitPx}
      `,
        )
        .join('\n')}

      Please provide a comprehensive analysis of:
      1. Trading style and patterns
      2. Risk management approach
      3. Position sizing and leverage usage
      4. Recent performance and profitability
      5. Notable strengths or concerns
      
      Keep the analysis concise but informative.
    `;

    const response = await this.llm.invoke(prompt);
    return response.content as string;
  }
}
