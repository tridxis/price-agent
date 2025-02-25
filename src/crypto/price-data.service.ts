import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface CryptoPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

@Injectable()
export class PriceDataService {
  private readonly logger = new Logger(PriceDataService.name);
  private readonly BINANCE_API = 'https://api.binance.com/api/v3';

  constructor(private readonly httpService: HttpService) {}

  async getPriceData(symbol: string): Promise<CryptoPrice> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ price: string }>(
          `${this.BINANCE_API}/ticker/price?symbol=${symbol.toUpperCase()}USDT`,
        ),
      );

      return {
        symbol: symbol.toUpperCase(),
        price: parseFloat(data.price),
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch price data for ${symbol}: ${(error as Error).message}`,
      );
      throw new Error(`Failed to fetch price data for ${symbol}`);
    }
  }
}
