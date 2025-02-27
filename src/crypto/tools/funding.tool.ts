import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../cache.service';

export interface ExchangeFunding {
  exchange: string;
  fundingRate: number;
  timestamp: number;
}

export interface FundingData {
  symbol: string;
  rates: ExchangeFunding[];
  averageRate: number;
}

interface BinanceFundingResponse {
  symbol: string;
  lastFundingRate: string;
}

interface BybitFundingResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: [
      {
        symbol: string;
        fundingRate: string;
        fundingRateTimestamp: string;
      },
    ];
  };
}

interface OKXFundingResponse {
  code: string;
  data: [
    {
      fundingRate: string;
      fundingTime: string;
      instId: string;
    },
  ];
}

@Injectable()
export class FundingTool {
  private readonly logger = new Logger(FundingTool.name);
  private readonly BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1';
  private readonly BYBIT_API = 'https://api.bybit.com/v5/market';
  private readonly OKX_API = 'https://www.okx.com/api/v5';

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {}

  async getFundingRates(symbol: string): Promise<FundingData> {
    const upperSymbol = symbol.toUpperCase();
    const cacheKey = `funding_${upperSymbol}`;
    const cached = this.cacheService.get(cacheKey);
    if (cached) return cached as unknown as FundingData;

    const result = await this.fetchFundingRates(upperSymbol);
    this.cacheService.set(cacheKey, result);
    return result;
  }

  private async fetchFundingRates(symbol: string): Promise<FundingData> {
    const ratePromises = [
      this.getBinanceFunding(symbol),
      this.getBybitFunding(symbol),
      this.getOKXFunding(symbol),
    ];

    const rates = await Promise.allSettled(ratePromises);

    const validRates = rates
      .filter(
        (result): result is PromiseFulfilledResult<ExchangeFunding> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);

    if (validRates.length === 0) {
      throw new Error(`No funding rate data available for ${symbol}`);
    }

    const averageRate =
      validRates.reduce((sum, rate) => sum + rate.fundingRate, 0) /
      validRates.length;

    return {
      symbol,
      rates: validRates,
      averageRate,
    };
  }

  private async getBinanceFunding(
    symbol: string,
  ): Promise<ExchangeFunding | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<BinanceFundingResponse>(
          `${this.BINANCE_FUTURES_API}/premiumIndex?symbol=${symbol}USDT`,
        ),
      );

      return {
        exchange: 'Binance',
        fundingRate: parseFloat(data.lastFundingRate) * 100,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`Binance funding fetch failed for ${symbol}`);
      return null;
    }
  }

  private async getBybitFunding(
    symbol: string,
  ): Promise<ExchangeFunding | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<BybitFundingResponse>(
          `${this.BYBIT_API}/funding/history?category=linear&symbol=${symbol}USDT&limit=1`,
        ),
      );

      if (data.retCode !== 0 || !data.result.list.length) {
        this.logger.warn(
          `Bybit funding fetch failed for ${symbol}: ${data.retMsg}`,
        );
        return null;
      }

      return {
        exchange: 'Bybit',
        fundingRate: parseFloat(data.result.list[0].fundingRate) * 100,
        timestamp: parseInt(data.result.list[0].fundingRateTimestamp),
      };
    } catch (error) {
      this.logger.warn(`Bybit funding fetch failed for ${symbol}`);
      return null;
    }
  }

  private async getOKXFunding(symbol: string): Promise<ExchangeFunding | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<OKXFundingResponse>(
          `${this.OKX_API}/public/funding-rate?instId=${symbol}-USDT-SWAP`,
        ),
      );

      return {
        exchange: 'OKX',
        fundingRate: parseFloat(data.data[0].fundingRate) * 100,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`OKX funding fetch failed for ${symbol}`);
      return null;
    }
  }
}
