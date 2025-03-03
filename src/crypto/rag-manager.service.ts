import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HistoricalDataService } from './historical-data.service';
import { PathRAGTool } from './tools/path-rag.tool';
import { PriceData } from './tools/price.tool';
import { CoinListService } from './coin-list.service';

interface TimeframedPriceData extends PriceData {
  changes: {
    '1h': number;
    '24h': number;
    '7d': number;
    '30d': number;
    '90d'?: number;
    '180d'?: number;
    '365d'?: number;
  };
  date?: string; // ISO date string
}

@Injectable()
export class RAGManagerService {
  private readonly logger = new Logger(RAGManagerService.name);
  private readonly priceRAG = new PathRAGTool<TimeframedPriceData>();
  private lastUpdateTime: number = 0;
  private dataStartDate: Date | null = null;
  private isInitialized = false;

  constructor(
    private readonly historicalDataService: HistoricalDataService,
    private readonly coinListService: CoinListService,
  ) {
    // Initial data load with retry
    void this.initializeData();
  }

  private async initializeData(retryCount = 0): Promise<void> {
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds

    try {
      if (!this.coinListService.isReady()) {
        if (retryCount < maxRetries) {
          this.logger.log('Waiting for coin list to initialize...');
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          await this.initializeData(retryCount + 1);
          return;
        }
        throw new Error('Coin list initialization timeout');
      }

      await this.updateRAGData();
      this.isInitialized = true;
      this.logger.log('RAG data initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize RAG data:', error);
      if (retryCount < maxRetries) {
        this.logger.log(
          `Retrying initialization (${retryCount + 1}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        await this.initializeData(retryCount + 1);
      }
    }
  }

  @Cron('*/15 * * * *')
  async updateRAGData(): Promise<void> {
    try {
      const symbols = this.coinListService.getSupportedCoins().slice(0, 10);
      if (symbols.length === 0) {
        this.logger.warn('No supported coins available');
        return;
      }

      this.lastUpdateTime = Date.now();

      // Process coins in batches of 5
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ({ symbol }) => {
            try {
              const [hourlyCandles, dailyCandles] = await Promise.all([
                this.historicalDataService.getCandles(symbol, '1h', 168),
                this.historicalDataService.getCandles(symbol, '1d', 365),
              ]);

              if (hourlyCandles.length > 0 && dailyCandles.length > 0) {
                const oldestDate = new Date(dailyCandles[0].timestamp);
                if (!this.dataStartDate || oldestDate < this.dataStartDate) {
                  this.dataStartDate = oldestDate;
                }

                this.storeCurrentPriceData(symbol, hourlyCandles, dailyCandles);
                this.storeHistoricalData(symbol, dailyCandles);
              }
            } catch (error) {
              this.logger.error(`Failed to update data for ${symbol}:`, error);
            }
          }),
        );

        // Add delay between batches
        if (i + batchSize < symbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      this.logger.log('RAG data updated successfully');
    } catch (error) {
      this.logger.error('Failed to update RAG data:', error);
    }
  }

  private storeCurrentPriceData(
    symbol: string,
    hourlyCandles: Array<{ close: number; timestamp: number; volume: number }>,
    dailyCandles: Array<{ close: number; timestamp: number; volume: number }>,
  ) {
    const currentPrice = hourlyCandles[hourlyCandles.length - 1].close;

    const changes = {
      '1h': this.calculatePriceChange(hourlyCandles, 1),
      '24h': this.calculatePriceChange(hourlyCandles, 24),
      '7d': this.calculatePriceChange(hourlyCandles, 168),
      '30d': this.calculatePriceChange(dailyCandles, 30),
      '90d': this.calculatePriceChange(dailyCandles, 90),
      '180d': this.calculatePriceChange(dailyCandles, 180),
      '365d': this.calculatePriceChange(dailyCandles, 365),
    };

    const priceData: TimeframedPriceData = {
      symbol,
      prices: [
        {
          exchange: 'Hyperliquid',
          price: currentPrice,
          timestamp: hourlyCandles[hourlyCandles.length - 1].timestamp,
          volume: hourlyCandles[hourlyCandles.length - 1].volume,
        },
      ],
      averagePrice: currentPrice,
      changes,
    };

    // Store current data
    this.priceRAG.insert(['prices', symbol], priceData);
  }

  private storeHistoricalData(
    symbol: string,
    dailyCandles: Array<{ close: number; timestamp: number; volume: number }>,
  ) {
    // Store each daily candle with date-based paths
    for (const candle of dailyCandles) {
      const date = new Date(candle.timestamp);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');

      const priceData: TimeframedPriceData = {
        symbol,
        prices: [
          {
            exchange: 'Hyperliquid',
            price: candle.close,
            timestamp: candle.timestamp,
            volume: candle.volume,
          },
        ],
        averagePrice: candle.close,
        changes: {
          '1h': 0,
          '24h': 0,
          '7d': 0,
          '30d': 0,
        },
        date: `${year}-${month}-${day}`,
      };

      // Store by date path: historical/BTC/2023/05/20
      this.priceRAG.insert(
        ['historical', symbol.toUpperCase(), year.toString(), month, day],
        priceData,
      );

      // Store by month path for monthly queries: historical/BTC/2023/05
      this.priceRAG.insert(
        ['historical', symbol.toUpperCase(), year.toString(), month],
        priceData,
      );
    }
  }

  // Search methods for different query types
  searchByDate(symbol: string, date: Date): TimeframedPriceData | null {
    console.log('searchByDate', symbol, date);
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');

    const results = this.priceRAG.search([
      'historical',
      symbol.toUpperCase(),
      year.toString(),
      month,
      day,
    ]);

    return results[0] || null;
  }

  searchByMonth(
    symbol: string,
    year: number,
    month: number,
  ): TimeframedPriceData[] {
    console.log('searchByMonth', symbol, year, month);
    return this.priceRAG.search([
      'historical',
      symbol.toUpperCase(),
      year.toString(),
      month.toString().padStart(2, '0'),
    ]);
  }

  private calculatePriceChange(
    candles: Array<{ close: number }>,
    periods: number,
  ): number {
    if (candles.length < periods) {
      this.logger.warn(
        `Not enough data for ${periods} periods (got ${candles.length})`,
      );
      return 0;
    }

    const currentPrice = candles[candles.length - 1].close;
    const oldIndex = Math.max(0, candles.length - periods);
    const oldPrice = candles[oldIndex].close;

    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }

  getPriceRAG(): PathRAGTool<TimeframedPriceData> {
    return this.priceRAG;
  }

  // Update getDataAvailability to include initialization status
  getDataAvailability(): {
    startDate: Date | null;
    lastUpdate: Date;
    isReady: boolean;
  } {
    return {
      startDate: this.dataStartDate,
      lastUpdate: new Date(this.lastUpdateTime),
      isReady: this.isInitialized,
    };
  }
}
