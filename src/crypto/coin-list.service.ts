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
export class CoinListService implements OnModuleInit {
  private readonly logger = new Logger(CoinListService.name);
  private supportedCoins: Map<string, CoinInfo> = new Map();
  private readonly HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';

  constructor(private readonly httpService: HttpService) {}

  async onModuleInit() {
    await this.updateCoinList();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateCoinList() {
    try {
      const coins = await this.getHyperliquidCoins();
      this.supportedCoins.clear();

      for (const coin of coins) {
        this.supportedCoins.set(coin.symbol, coin);
      }

      this.logger.log(
        `Updated coin list. Total coins: ${this.supportedCoins.size}`,
      );
    } catch (error) {
      this.logger.error('Failed to update coin list:', error);
    }
  }

  private async getHyperliquidCoins(): Promise<CoinInfo[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<HyperliquidMeta>(
          this.HYPERLIQUID_API,
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
    const coin = this.supportedCoins.get(query.toLowerCase());
    return coin ? coin.id : null;
  }

  getSupportedCoins(): CoinInfo[] {
    return Array.from(this.supportedCoins.values());
  }
}
