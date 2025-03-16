import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HistoricalDataService } from '../shared/services/historical-data.service';
import { PathRAGTool } from '../shared/tools/path-rag.tool';
import { CoinListService } from '../shared/services/coin-list.service';
import { TechnicalAnalysisService } from './technical-analysis.service';
import { TechnicalTerm } from './utils/price-query.parser';
import { TimeframedPriceData } from '../shared/types/price.type';

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
    private readonly technicalAnalysis: TechnicalAnalysisService,
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
                this.historicalDataService.getCandles(symbol, '1d', 3650),
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
    dailyCandles: Array<{
      close: number;
      high: number;
      low: number;
      timestamp: number;
      volume: number;
    }>,
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
    dailyCandles: Array<{
      close: number;
      high: number;
      low: number;
      timestamp: number;
      volume: number;
    }>,
  ) {
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
        highPrice: candle.high,
        lowPrice: candle.low,
        changes: {
          '1h': 0,
          '24h': 0,
          '7d': 0,
          '30d': 0,
        },
        date: `${year}-${month}-${day}`,
      };

      // Store by date path only
      this.priceRAG.insert(
        ['historical', symbol.toUpperCase(), year.toString(), month, day],
        priceData,
      );
    }
  }

  // Search methods for different query types
  searchByDate(symbol: string, date: Date): TimeframedPriceData | null {
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
    priceType?: 'highest' | 'lowest',
  ): TimeframedPriceData[] {
    const results: TimeframedPriceData[] = [];

    // Get all days in the month
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dailyPrices = this.priceRAG.search([
        'historical',
        symbol.toUpperCase(),
        year.toString(),
        month.toString().padStart(2, '0'),
        day.toString().padStart(2, '0'),
      ]);
      results.push(...dailyPrices);
    }

    if (priceType && results.length > 0) {
      const prices = results.map((r) => ({
        data: r,
        price:
          priceType === 'highest'
            ? r.highPrice || r.averagePrice
            : r.lowPrice || r.averagePrice,
      }));

      const extremePrice =
        priceType === 'highest'
          ? Math.max(...prices.map((p) => p.price))
          : Math.min(...prices.map((p) => p.price));

      const result = prices.find((p) => p.price === extremePrice)?.data;
      if (result) {
        return [
          {
            ...result,
            averagePrice: extremePrice, // Use the extreme price as the average price for display
          },
        ];
      }
    }

    return results;
  }

  searchByYear(
    symbol: string,
    year: number,
    priceType?: 'highest' | 'lowest',
  ): TimeframedPriceData | null {
    const results: TimeframedPriceData[] = [];

    // Search through each day of the year instead of months
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(year, month, 0).getDate();

      for (let day = 1; day <= daysInMonth; day++) {
        const dailyPrices = this.priceRAG.search([
          'historical',
          symbol.toUpperCase(),
          year.toString(),
          month.toString().padStart(2, '0'),
          day.toString().padStart(2, '0'),
        ]);
        results.push(...dailyPrices);
      }
    }

    if (results.length === 0) return null;

    if (priceType) {
      const prices = results.map((r) => ({
        data: r,
        price:
          priceType === 'highest'
            ? r.highPrice || r.averagePrice
            : r.lowPrice || r.averagePrice,
      }));

      const extremePrice =
        priceType === 'highest'
          ? Math.max(...prices.map((p) => p.price))
          : Math.min(...prices.map((p) => p.price));

      const result = prices.find((p) => p.price === extremePrice)?.data;
      if (result) {
        return {
          ...result,
          averagePrice: extremePrice, // Use the extreme price as the average price for display
        };
      }
    }

    // If no price type specified, return average
    const avgPrice =
      results.reduce((sum, r) => sum + r.averagePrice, 0) / results.length;
    return {
      ...results[0],
      averagePrice: avgPrice,
    };
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

  searchAllTime(
    symbol: string,
    priceType: 'highest' | 'lowest',
  ): TimeframedPriceData | null {
    const results: TimeframedPriceData[] = [];
    const upperSymbol = symbol.toUpperCase();

    // Get all years from data start date to now
    const startYear =
      this.dataStartDate?.getFullYear() || new Date().getFullYear();
    const endYear = new Date().getFullYear();

    // Search through each day of each year
    for (let year = startYear; year <= endYear; year++) {
      for (let month = 1; month <= 12; month++) {
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
          const dailyPrices = this.priceRAG.search([
            'historical',
            upperSymbol,
            year.toString(),
            month.toString().padStart(2, '0'),
            day.toString().padStart(2, '0'),
          ]);
          results.push(...dailyPrices);
        }
      }
    }

    if (results.length === 0) return null;

    const prices = results.map((r) => ({
      data: r,
      price:
        priceType === 'highest'
          ? r.highPrice || r.averagePrice
          : r.lowPrice || r.averagePrice,
    }));

    const extremePrice =
      priceType === 'highest'
        ? Math.max(...prices.map((p) => p.price))
        : Math.min(...prices.map((p) => p.price));

    const result = prices.find((p) => p.price === extremePrice)?.data;
    if (result) {
      return {
        ...result,
        averagePrice: extremePrice,
      };
    }

    return null;
  }

  searchLocalExtremum(
    symbol: string,
    priceType: 'highest' | 'lowest',
    days: number,
  ): TimeframedPriceData | null {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const results: TimeframedPriceData[] = [];
    const upperSymbol = symbol.toUpperCase();

    // Get dates from cutoff to now
    const startDate = new Date(cutoffDate);
    const endDate = new Date();

    // Search through each day in the range
    for (
      let date = startDate;
      date <= endDate;
      date.setDate(date.getDate() + 1)
    ) {
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');

      const dailyPrices = this.priceRAG.search([
        'historical',
        upperSymbol,
        year.toString(),
        month,
        day,
      ]);
      results.push(...dailyPrices);
    }

    if (results.length === 0) return null;

    const prices = results.map((r) => ({
      data: r,
      price:
        priceType === 'highest'
          ? r.highPrice || r.averagePrice
          : r.lowPrice || r.averagePrice,
    }));

    const extremePrice =
      priceType === 'highest'
        ? Math.max(...prices.map((p) => p.price))
        : Math.min(...prices.map((p) => p.price));

    const result = prices.find((p) => p.price === extremePrice)?.data;

    if (result) {
      return {
        ...result,
        averagePrice: extremePrice,
      };
    }

    return null;
  }

  getTechnicalAnalysis(symbol: string, type: TechnicalTerm, period?: number) {
    const days = period || 30; // Default to 30 days if period is undefined
    const results: TimeframedPriceData[] = [];
    const upperSymbol = symbol.toUpperCase();
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    // Get historical data
    for (
      let date = startDate;
      date <= endDate;
      date.setDate(date.getDate() + 1)
    ) {
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');

      const dailyPrices = this.priceRAG.search([
        'historical',
        upperSymbol,
        year.toString(),
        month,
        day,
      ]);
      results.push(...dailyPrices);
    }

    if (results.length === 0) return null;

    switch (type) {
      case 'trend':
        return this.technicalAnalysis.analyzeTrend(results);
      case 'support':
      case 'resistance':
        return this.technicalAnalysis.findSupportResistance(results);
      case 'rsi':
        return {
          value: this.technicalAnalysis.calculateRSI(
            results.map((d) => d.averagePrice),
            period || 14, // Default to 14 days for RSI
          ),
          description: 'RSI indicates overbought > 70, oversold < 30',
        };
      case 'ma':
        return {
          value: this.technicalAnalysis.calculateMA(
            results.map((d) => d.averagePrice),
            period || 14, // Default to 14 days for MA
          ),
          description: `${period || 14}-day Moving Average`,
        };
      case 'dip':
      case 'peak':
        return this.searchLocalExtremum(
          symbol,
          type === 'dip' ? 'lowest' : 'highest',
          days,
        );
      case 'ath':
      case 'atl':
        return this.searchAllTime(
          symbol,
          type === 'ath' ? 'highest' : 'lowest',
        );
      default:
        return null;
    }
  }

  async getHistoricalData(
    symbol: string,
    days: number,
  ): Promise<TimeframedPriceData[]> {
    try {
      const response = await this.historicalDataService.getCandles(
        symbol,
        '1h',
        days * 24 + 720,
      );

      return response.slice(720).map((c, index) => ({
        symbol,
        prices: [
          {
            exchange: 'Hyperliquid',
            price: c.close,
            timestamp: c.timestamp,
            volume: c.volume,
          },
        ],
        averagePrice: c.close,
        changes: {
          '1h': this.calculatePriceChange(
            response.slice(0, response.length - index),
            1,
          ),
          '24h': this.calculatePriceChange(
            response.slice(0, response.length - index),
            24,
          ),
          '7d': this.calculatePriceChange(
            response.slice(0, response.length - index),
            168,
          ),
          '30d': this.calculatePriceChange(
            response.slice(0, response.length - index),
            720,
          ),
        },
        highPrice: c.high,
        lowPrice: c.low,
      }));
    } catch (error) {
      this.logger.error(`Failed to get historical data for ${symbol}:`, error);
      return [];
    }
  }
}
