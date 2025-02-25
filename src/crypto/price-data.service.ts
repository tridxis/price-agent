import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

@Injectable()
export class PriceDataService {
  private readonly logger = new Logger(PriceDataService.name);
  private readonly BINANCE_API = 'https://api.binance.com/api/v3';
  private readonly BYBIT_API = 'https://api.bybit.com/v5/market';
  private readonly OKX_API = 'https://www.okx.com/api/v5/market';

  constructor(private readonly httpService: HttpService) {}

  async getPriceData(symbol: string): Promise<CryptoPrice> {
    try {
      const [binancePrice, bybitPrice, okxPrice] = await Promise.all([
        this.getBinancePrice(symbol),
        this.getBybitPrice(symbol),
        this.getOKXPrice(symbol),
      ]);

      const prices: ExchangePrice[] = [
        binancePrice,
        bybitPrice,
        okxPrice,
      ].filter((price): price is ExchangePrice => price !== null);

      if (prices.length === 0) {
        throw new Error(`No price data available for ${symbol}`);
      }

      const averagePrice =
        prices.reduce((sum, price) => sum + price.price, 0) / prices.length;

      return {
        symbol: symbol.toUpperCase(),
        prices,
        averagePrice,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch price data for ${symbol}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to fetch price data for ${symbol}`);
    }
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
}
