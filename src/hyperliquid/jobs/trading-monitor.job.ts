import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TradingAgentService } from '../services/trading-agent.service';
import { CacheService } from '../../shared/services/cache.service';
import { CoinListService } from 'src/shared';
import { TradingSignal } from '../services/trading-agent.service';

interface TradingOpportunity {
  coin: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasons: string[];
  timestamp: number;
}

@Injectable()
export class TradingMonitorJob {
  private readonly logger = new Logger(TradingMonitorJob.name);
  private monitoredCoins: string[] = [];
  private readonly BATCH_SIZE = 5; // Process 5 coins at a time
  private readonly BATCH_DELAY = 2000; // 2 seconds between batches

  constructor(
    private readonly tradingAgentService: TradingAgentService,
    private readonly cacheService: CacheService,
    private readonly coinListService: CoinListService,
  ) {
    setTimeout(() => {
      this.monitoredCoins = this.coinListService
        .getSupportedCoins()
        .map((coin) => coin.symbol.toUpperCase());
      this.logger.log(`Initialized with ${this.monitoredCoins.length} coins`);
      void this.monitorTradingOpportunities();
    }, 10000);
  }

  @Cron('*/15 * * * *')
  async monitorTradingOpportunities() {
    this.logger.log('Scanning for trading opportunities...');

    try {
      const opportunities: TradingOpportunity[] = [];

      // Process coins in batches
      for (let i = 0; i < this.monitoredCoins.length; i += this.BATCH_SIZE) {
        const batch = this.monitoredCoins.slice(i, i + this.BATCH_SIZE);
        this.logger.debug(
          `Processing batch ${i / this.BATCH_SIZE + 1}: ${batch.join(', ')}`,
        );

        // Analyze current batch
        const batchAnalyses = await Promise.all(
          batch.map((coin) => this.analyzeWithRetry(coin)),
        );

        // Add valid signals to opportunities
        batchAnalyses.forEach((signal, index) => {
          if (signal) {
            opportunities.push({
              coin: batch[index],
              side: signal.side,
              entryPrice: signal.entryPrice,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
              confidence: signal.confidence,
              reasons: signal.reason,
              timestamp: Date.now(),
            });
          }
        });

        // Wait between batches to avoid rate limits
        if (i + this.BATCH_SIZE < this.monitoredCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
        }
      }

      // Log findings
      this.logOpportunities(opportunities);
    } catch (error) {
      this.logger.error('Error monitoring trading opportunities:', error);
    }
  }

  private async analyzeWithRetry(
    coin: string,
    maxRetries = 3,
    delay = 2000,
  ): Promise<TradingSignal | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.tradingAgentService.analyzeTradeOpportunity(coin);
      } catch (error: any) {
        if (error.response?.status === 429) {
          this.logger.warn(
            `Rate limit hit for ${coin}, attempt ${attempt}/${maxRetries}. Waiting ${
              delay / 1000
            }s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          // Increase delay for next retry
          delay *= 2;
        } else {
          this.logger.error(`Error analyzing ${coin}:`, error);
          return null;
        }
      }
    }
    this.logger.error(`Failed to analyze ${coin} after ${maxRetries} attempts`);
    return null;
  }

  private logOpportunities(opportunities: TradingOpportunity[]) {
    if (opportunities.length === 0) {
      this.logger.log('No trading opportunities found in this scan');
      return;
    }

    const summary = opportunities
      .map((opp) => {
        const riskReward = Math.abs(
          (opp.takeProfit - opp.entryPrice) / (opp.stopLoss - opp.entryPrice),
        ).toFixed(2);

        return `
${opp.coin} - ${opp.side.toUpperCase()} (${opp.confidence}% confidence)
Entry: $${opp.entryPrice.toFixed(2)} | SL: $${opp.stopLoss.toFixed(2)} | TP: $${opp.takeProfit.toFixed(2)}
R/R Ratio: ${riskReward}
Reasons: ${opp.reasons.join(', ')}
`;
      })
      .join('\n');

    this.logger.log(
      `\nTrading Opportunities Found (${new Date().toISOString()}):\n${summary}`,
    );

    // Log high confidence opportunities separately
    const highConfidence = opportunities.filter((opp) => opp.confidence >= 75);
    if (highConfidence.length > 0) {
      this.logger.warn(
        `\nHigh Confidence Signals (≥75%):\n${highConfidence
          .map(
            (opp) =>
              `${opp.coin}: ${opp.side.toUpperCase()} @ $${opp.entryPrice.toFixed(2)}`,
          )
          .join('\n')}`,
      );
    }
  }
}
