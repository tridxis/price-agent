import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';

interface CoinInfo {
  id: string;
  symbol: string;
  name: string;
}

interface HyperliquidMeta {
  universe: {
    maxLeverage: string;
    name: string;
    szDecimals: number;
  }[];
}

@Injectable()
export class CoinListService {
  private readonly logger = new Logger(CoinListService.name);
  private readonly coins: Map<string, CoinInfo> = new Map();
  private isInitialized = false;

  constructor(private readonly httpService: HttpService) {
    // Initial load
    void this.updateCoinList().then(() => {
      this.isInitialized = true;
      this.logger.log('Coin list initialized successfully');
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateCoinList(): Promise<void> {
    try {
      const coins = await this.getHyperliquidCoins();
      this.coins.clear();

      for (const coin of coins) {
        this.coins.set(coin.symbol, coin);
      }

      this.logger.log(`Updated coin list. Total coins: ${this.coins.size}`);
    } catch (error) {
      this.logger.error('Failed to update coin list:', error);
    }
  }

  private async getHyperliquidCoins(): Promise<CoinInfo[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<HyperliquidMeta>(
          'https://api.hyperliquid.xyz/info',
          { type: 'meta' },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      return data.universe.map((coin) => ({
        id: coin.name.toLowerCase(),
        symbol: coin.name.toLowerCase(),
        name: coin.name,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch Hyperliquid coins:', error);
      return [];
    }
  }

  findCoinId(query: string): string | null {
    const coin = this.coins.get(query.toLowerCase());
    return coin ? coin.id : null;
  }

  getSupportedCoins(): CoinInfo[] {
    if (!this.isInitialized) {
      this.logger.warn('Coin list not yet initialized');
      return [];
    }
    return Array.from(this.coins.values());
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}
