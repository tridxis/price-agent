import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';

interface BinanceSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

interface CoinInfo {
  id: string;
  symbol: string;
  name: string;
}

interface BinanceResponse {
  symbols: BinanceSymbol[];
}

@Injectable()
export class CoinListService implements OnModuleInit {
  private supportedCoins: Map<string, CoinInfo> = new Map();
  private readonly BINANCE_API = 'https://api.binance.com/api/v3';

  constructor(private readonly httpService: HttpService) {}

  async onModuleInit() {
    await this.updateCoinList();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateCoinList() {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<BinanceResponse>(
          `${this.BINANCE_API}/exchangeInfo`,
        ),
      );

      this.supportedCoins.clear();
      const usdtPairs = data.symbols.filter(
        (symbol: BinanceSymbol) =>
          symbol.quoteAsset === 'USDT' && symbol.status === 'TRADING',
      );

      for (const pair of usdtPairs) {
        const coin: CoinInfo = {
          id: pair.baseAsset.toLowerCase(),
          symbol: pair.baseAsset.toLowerCase(),
          name: pair.baseAsset,
        };
        this.supportedCoins.set(coin.symbol.toLowerCase(), coin);
      }
    } catch (error) {
      console.error(
        'Failed to update Binance symbols:',
        (error as Error).message,
      );
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
