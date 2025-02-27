import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from './cache.service';

interface ExchangePrice {
  exchange: string;
  price: number;
  timestamp: number;
}

export interface CryptoPrice {
  symbol: string;
  prices: ExchangePrice[];
  averagePrice: number;
}

interface HyperliquidResponse {
  [key: string]: number;
}

@Injectable()
export class PriceDataService {
  private readonly logger = new Logger(PriceDataService.name);
  private readonly BINANCE_API = 'https://api.binance.com/api/v3';
  private readonly BYBIT_API = 'https://api.bybit.com/v5/market';
  private readonly OKX_API = 'https://www.okx.com/api/v5/market';
  private readonly HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {}

  async getPriceData(symbol: string): Promise<CryptoPrice> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache first
    const cached = this.cacheService.get(upperSymbol);
    if (cached) {
      return cached;
    }

    // If not in cache, fetch fresh data
    const result = await this.fetchPriceData(upperSymbol);

    // Store in cache
    this.cacheService.set(upperSymbol, result);

    return result;
  }

  private async fetchPriceData(symbol: string): Promise<CryptoPrice> {
    const pricePromises = [
      this.getBinancePrice(symbol),
      this.getBybitPrice(symbol),
      this.getOKXPrice(symbol),
      this.getHyperliquidPrice(symbol),
    ];

    const prices = await Promise.allSettled(pricePromises);

    const validPrices = prices
      .filter(
        (result): result is PromiseFulfilledResult<ExchangePrice> =>
          result.status === 'fulfilled' && result.value !== null,
      )
      .map((result) => result.value);

    if (validPrices.length === 0) {
      throw new Error(`No price data available for ${symbol}`);
    }

    const averagePrice =
      validPrices.reduce((sum, price) => sum + price.price, 0) /
      validPrices.length;

    return {
      symbol,
      prices: validPrices,
      averagePrice,
    };
  }

  private async getBinancePrice(symbol: string): Promise<ExchangePrice | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ price: string }>(
          `${this.BINANCE_API}/ticker/price?symbol=${symbol.toUpperCase()}USDT`,
        ),
      );

      return {
        exchange: 'Binance',
        price: parseFloat(data.price),
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`Binance price fetch failed for ${symbol}`);
      return null;
    }
  }

  private async getBybitPrice(symbol: string): Promise<ExchangePrice | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{
          result: { list: [{ lastPrice: string }] };
        }>(
          `${this.BYBIT_API}/tickers?category=spot&symbol=${symbol.toUpperCase()}USDT`,
        ),
      );

      return {
        exchange: 'Bybit',
        price: parseFloat(data.result.list[0].lastPrice),
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`Bybit price fetch failed for ${symbol}`);
      return null;
    }
  }

  private async getOKXPrice(symbol: string): Promise<ExchangePrice | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{
          data: [{ last: string }];
        }>(`${this.OKX_API}/ticker?instId=${symbol.toUpperCase()}-USDT`),
      );

      return {
        exchange: 'OKX',
        price: parseFloat(data.data[0].last),
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn(`OKX price fetch failed for ${symbol}`);
      return null;
    }
  }

  private async getHyperliquidPrice(
    symbol: string,
  ): Promise<ExchangePrice | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<HyperliquidResponse>(
          this.HYPERLIQUID_API,
          { type: 'allMids' },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const price = data[symbol];

      if (!price) {
        return null;
      }

      return {
        exchange: 'Hyperliquid',
        price,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.log(error);
      this.logger.warn(`Hyperliquid price fetch failed for ${symbol}`);
      return null;
    }
  }
}
