import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleResponse } from '../types/candle.type';

@Injectable()
export class HistoricalDataService {
  private readonly logger = new Logger(HistoricalDataService.name);
  private readonly API_URL = 'https://api-ui.hyperliquid.xyz/info';
  private readonly requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_DELAY = 500; // 500ms between requests

  constructor(private readonly httpService: HttpService) {}

  async getCandles(
    symbol: string,
    interval = '15m',
    limit = 100,
  ): Promise<Candle[]> {
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        try {
          const candles = await this.fetchCandlesWithRetry(
            symbol,
            interval,
            limit,
          );
          resolve(candles);
        } catch (error) {
          this.logger.error(`Failed to fetch candles for ${symbol}: ${error}`);
          resolve([]);
        }
      });

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;
    try {
      while (this.requestQueue.length > 0) {
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastRequest),
          );
        }

        const request = this.requestQueue.shift();
        if (request) {
          this.lastRequestTime = Date.now();
          await request();
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async fetchCandlesWithRetry(
    symbol: string,
    interval: string,
    limit: number,
    retryCount = 0,
  ): Promise<Candle[]> {
    const maxRetries = 1;
    const retryDelay = 2000; // 2 seconds

    try {
      const endTime = Date.now();
      const startTime = endTime - limit * this.getIntervalMs(interval);

      // this.logger.debug(
      //   `Fetching candles for ${symbol} (attempt ${retryCount + 1}/${maxRetries + 1})`,
      // );

      const { data } = await firstValueFrom(
        this.httpService.post<CandleResponse[]>(
          this.API_URL,
          {
            type: 'candleSnapshot',
            req: {
              coin: symbol.toUpperCase(),
              interval,
              startTime,
              endTime,
            },
          },
          {
            timeout: 10000, // 10 second timeout
          },
        ),
      );

      return data.map((response) => this.mapResponseToCandle(response));
    } catch (error) {
      if (retryCount < maxRetries) {
        // this.logger.warn(
        //   `Retrying candle fetch for ${symbol} (${retryCount + 1}/${maxRetries})`,
        // );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return this.fetchCandlesWithRetry(
          symbol,
          interval,
          limit,
          retryCount + 1,
        );
      }
      throw error;
    }
  }

  private mapResponseToCandle(response: CandleResponse): Candle {
    return {
      timestamp: response.t,
      open: parseFloat(response.o),
      high: parseFloat(response.h),
      low: parseFloat(response.l),
      close: parseFloat(response.c),
      volume: parseFloat(response.v),
      symbol: response.s,
      interval: response.i,
    };
  }

  private getIntervalMs(interval: string): number {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1));

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 15 * 60 * 1000; // default to 15m
    }
  }
}
