import { Injectable, Logger } from '@nestjs/common';
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

interface CMCResponse {
  data: {
    id: number;
    name: string;
    symbol: string;
    slug: string;
  }[];
  status: {
    timestamp: string;
    error_code: number;
    error_message: string | null;
  };
}

@Injectable()
export class CoinListService {
  private readonly logger = new Logger(CoinListService.name);
  private readonly coins: Map<string, CoinInfo> = new Map();
  private readonly CMC_API = 'https://pro-api.coinmarketcap.com/v1';
  private readonly CMC_API_KEY = process.env.COINMARKETCAP_API_KEY;
  private isInitialized = false;

  constructor(private readonly httpService: HttpService) {
    if (!this.CMC_API_KEY) {
      this.logger.warn('COINMARKETCAP_API_KEY not set');
    }
    // Initial load
    void this.updateCoinList().then(() => {
      this.isInitialized = true;
      this.logger.log('Coin list initialized successfully');
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateCoinList(): Promise<void> {
    try {
      const [hyperliquidCoins, cmcCoins] = await Promise.all([
        this.getHyperliquidCoins(),
        this.getCMCCoins(),
      ]);

      this.coins.clear();

      // Create a map of CMC info by symbol for quick lookup
      const cmcInfoMap = new Map(
        cmcCoins.map((coin) => [coin.symbol.toUpperCase(), coin]),
      );

      // Combine Hyperliquid and CMC data
      for (const coin of hyperliquidCoins) {
        const upperSymbol = coin.symbol.toUpperCase();
        const cmcInfo = cmcInfoMap.get(upperSymbol);

        this.coins.set(coin.symbol, {
          id: coin.id,
          symbol: coin.symbol,
          name: cmcInfo?.name || coin.name, // Use CMC name if available
        });
      }

      this.logger.debug('Updated coins:', this.coins);
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

  private async getCMCCoins(): Promise<
    { id: number; name: string; symbol: string; slug: string }[]
  > {
    if (!this.CMC_API_KEY) {
      return [];
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<CMCResponse>(
          `${this.CMC_API}/cryptocurrency/map`,
          {
            headers: {
              'X-CMC_PRO_API_KEY': this.CMC_API_KEY,
              Accept: 'application/json',
            },
            params: {
              limit: 5000,
              sort: 'cmc_rank',
            },
          },
        ),
      );

      if (data.status.error_code !== 0) {
        throw new Error(data.status.error_message || 'CMC API error');
      }

      return data.data;
    } catch (error) {
      this.logger.error('Failed to fetch CMC coins:', error);
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
