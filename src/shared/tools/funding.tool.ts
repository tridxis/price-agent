import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../services/cache.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FundingData } from '../types/funding.type';

type ExchangeMapping = {
  [key: string]: string;
};

type HyperliquidResponse = [
  string,
  [string, { fundingRate: string; nextFundingTime: number }][],
][];

// @Injectable()
export class FundingTool implements OnModuleInit {
  private readonly logger = new Logger(FundingTool.name);
  private readonly HYPERLIQUID_API = 'https://api-ui.hyperliquid.xyz/info';
  private readonly exchangeMapping: ExchangeMapping = {
    BinPerp: 'Binance',
    HlPerp: 'Hyperliquid',
    BybitPerp: 'Bybit',
  };

  private fundingRatesMap: Map<string, FundingData> = new Map();
  private lastUpdate = 0;
  private readonly UPDATE_INTERVAL = 60000 * 60; // 1 hour

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {}

  async onModuleInit() {
    await this.updateAllFundingRates();
  }

  @Cron(CronExpression.EVERY_HOUR)
  private async updateAllFundingRates(): Promise<void> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<HyperliquidResponse>(
          this.HYPERLIQUID_API,
          { type: 'predictedFundings' },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const timestamp = Date.now();
      this.fundingRatesMap.clear();

      for (const [symbol, exchangeRates] of data) {
        const rates = exchangeRates.map(([exchange, rate]) => ({
          exchange: this.exchangeMapping[exchange] || exchange,
          fundingRate: rate?.fundingRate
            ? parseFloat(rate?.fundingRate) * 100
            : 0,
          timestamp,
          nextFundingTime: rate?.nextFundingTime || 0,
        }));

        const averageRate =
          rates.reduce((sum, rate) => sum + rate.fundingRate, 0) / rates.length;

        const fundingData: FundingData = {
          symbol,
          rates,
          averageRate,
        };

        this.fundingRatesMap.set(symbol, fundingData);
        this.cacheService.set(`funding_${symbol}`, fundingData, 'funding');
      }

      this.lastUpdate = timestamp;
      this.logger.debug(
        `Updated funding rates for ${this.fundingRatesMap.size} symbols`,
      );
    } catch (error) {
      this.logger.error('Failed to update funding rates:', error);
    }
  }

  async getFundingRates(symbol: string): Promise<FundingData> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache first
    const cached = this.cacheService.get(`funding_${upperSymbol}`, 'funding');
    if (cached) return cached as unknown as FundingData;

    // If data is stale, update all rates
    if (Date.now() - this.lastUpdate > this.UPDATE_INTERVAL) {
      await this.updateAllFundingRates();
    }

    const fundingData = this.fundingRatesMap.get(upperSymbol);
    if (!fundingData) {
      throw new Error(`No funding rate data available for ${upperSymbol}`);
    }

    return fundingData;
  }

  getAllFundingRates(): FundingData[] {
    return Array.from(this.fundingRatesMap.values());
  }
}
