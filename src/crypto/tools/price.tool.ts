import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../cache.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExchangePrice, PriceData } from '../types/price.type';

interface HyperliquidResponse {
  [key: string]: number;
}

@Injectable()
export class PriceTool implements OnModuleInit {
  private readonly logger = new Logger(PriceTool.name);
  private readonly BINANCE_API = 'https://fapi.binance.com/fapi/v1';
  private readonly BYBIT_API = 'https://api.bybit.com/v5/market';
  private readonly OKX_API = 'https://www.okx.com/api/v5/public';
  private readonly HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';

  private pricesMap: Map<string, PriceData> = new Map();
  private lastUpdate = 0;
  private readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes for prices

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {}

  async onModuleInit() {
    await this.updateAllPrices();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  private async updateAllPrices(): Promise<void> {
    try {
      const [binanceData, bybitData, hyperliquidData, okxData] =
        await Promise.all([
          this.fetchBinancePrices(),
          this.fetchBybitPrices(),
          this.fetchHyperliquidPrices(),
          this.fetchOKXPrices(),
        ]);

      const timestamp = Date.now();
      this.pricesMap.clear();

      // Merge all price data
      const allSymbols = new Set([
        ...binanceData.keys(),
        ...bybitData.keys(),
        ...hyperliquidData.keys(),
        ...okxData.keys(),
      ]);

      for (const symbol of allSymbols) {
        const prices: ExchangePrice[] = [];

        const binancePrice = binanceData.get(symbol);
        if (binancePrice)
          prices.push({ exchange: 'Binance', price: binancePrice, timestamp });

        const bybitPrice = bybitData.get(symbol);
        if (bybitPrice)
          prices.push({ exchange: 'Bybit', price: bybitPrice, timestamp });

        const hyperliquidPrice = hyperliquidData.get(symbol);
        if (hyperliquidPrice)
          prices.push({
            exchange: 'Hyperliquid',
            price: hyperliquidPrice,
            timestamp,
          });

        const okxPrice = okxData.get(symbol);
        if (okxPrice)
          prices.push({ exchange: 'OKX', price: okxPrice, timestamp });

        if (prices.length > 0) {
          const averagePrice =
            prices.reduce((sum, p) => sum + p.price, 0) / prices.length;

          const priceData: PriceData = {
            symbol,
            prices,
            averagePrice,
          };

          this.pricesMap.set(symbol, priceData);
          this.cacheService.set(`price_${symbol}`, priceData, 'price');
        }
      }

      this.lastUpdate = timestamp;
      this.logger.debug(`Updated prices for ${this.pricesMap.size} symbols`);
    } catch (error) {
      this.logger.error('Failed to update prices:', error);
    }
  }

  private async fetchBinancePrices(): Promise<Map<string, number>> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ symbol: string; markPrice: string }[]>(
          `${this.BINANCE_API}/premiumIndex`,
        ),
      );

      return new Map(
        data
          .filter((item) => item.symbol.endsWith('USDT'))
          .map((item) => [
            item.symbol.replace('USDT', ''),
            parseFloat(item.markPrice),
          ]),
      );
    } catch (error) {
      this.logger.error('Failed to fetch Binance perpetual prices:', error);
      return new Map();
    }
  }

  private async fetchBybitPrices(): Promise<Map<string, number>> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{
          result: { list: { symbol: string; markPrice: string }[] };
        }>(`${this.BYBIT_API}/tickers?category=linear`),
      );

      return new Map(
        data.result.list
          .filter((item) => item.symbol.endsWith('USDT'))
          .map((item) => [
            item.symbol.replace('USDT', ''),
            parseFloat(item.markPrice),
          ]),
      );
    } catch (error) {
      this.logger.error('Failed to fetch Bybit perpetual prices:', error);
      return new Map();
    }
  }

  private async fetchOKXPrices(): Promise<Map<string, number>> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{
          data: { instId: string; markPx: string }[];
        }>(`${this.OKX_API}/mark-price?instType=SWAP`),
      );

      return new Map(
        data.data
          .filter((item) => item.instId.endsWith('-USDT-SWAP'))
          .map((item) => [item.instId.split('-')[0], parseFloat(item.markPx)]),
      );
    } catch (error) {
      this.logger.error('Failed to fetch OKX perpetual prices:', error);
      return new Map();
    }
  }

  private async fetchHyperliquidPrices(): Promise<Map<string, number>> {
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

      return new Map(Object.entries(data));
    } catch (error) {
      this.logger.error('Failed to fetch Hyperliquid perpetual prices:', error);
      return new Map();
    }
  }

  async getPrices(symbol: string): Promise<PriceData> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache first
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const cached = this.cacheService.get(`price_${upperSymbol}`, 'price');
    if (cached) return cached as unknown as PriceData;

    // If data is stale, update all prices
    if (Date.now() - this.lastUpdate > this.UPDATE_INTERVAL) {
      await this.updateAllPrices();
    }

    const priceData = this.pricesMap.get(upperSymbol);
    if (!priceData) {
      throw new Error(`No price data available for ${upperSymbol}`);
    }

    return priceData;
  }

  getAllPrices(): PriceData[] {
    return Array.from(this.pricesMap.values());
  }
}
