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
      // this.monitoredCoins = ['SNX'];
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

        // Analyze and log each coin's signal immediately
        await Promise.all(
          batch.map(async (coin) => {
            const signal = await this.analyzeWithRetry(coin);
            if (signal) {
              opportunities.push({
                coin: signal.coin,
                side: signal.side,
                entryPrice: signal.entryPrice,
                stopLoss: signal.stopLoss,
                takeProfit: signal.takeProfit,
                confidence: signal.confidence,
                reasons: signal.reason,
                timestamp: Date.now(),
              });
              // Log individual signal immediately
              this.logSignal(signal);
            }
          }),
        );

        // Wait between batches to avoid rate limits
        if (i + this.BATCH_SIZE < this.monitoredCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
        }
      }

      // Log summary at the end
      if (opportunities.length > 0) {
        this.logSummary(opportunities);
      } else {
        this.logger.log('No trading opportunities found in this scan');
      }
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

  private logSignal(signal: TradingSignal) {
    const riskReward = Math.abs(
      (signal.takeProfit - signal.entryPrice) /
        (signal.stopLoss - signal.entryPrice),
    ).toFixed(4);

    this.logger.log(`
Signal Found: ${signal.coin} - ${signal.side.toUpperCase()} (${signal.confidence}% confidence)
Entry: $${Number(signal.entryPrice).toFixed(4)} | SL: $${Number(signal.stopLoss).toFixed(4)} | TP: $${Number(signal.takeProfit).toFixed(4)}
R/R Ratio: ${riskReward}
Reasons: ${signal.reason.join(', ')}
`);
  }

  private logSummary(opportunities: TradingOpportunity[]) {
    const highConfidence = opportunities.filter((opp) => opp.confidence >= 75);
    if (highConfidence.length > 0) {
      this.logger.warn(
        `\nHigh Confidence Signals Summary (≥75%):\n${highConfidence
          .map(
            (opp) =>
              `${opp.coin}: ${opp.side.toUpperCase()} @ $${Number(opp.entryPrice).toFixed(4)}`,
          )
          .join('\n')}`,
      );
    }
  }
}
