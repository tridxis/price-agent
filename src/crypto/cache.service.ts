import { Injectable } from '@nestjs/common';
import { PriceData } from './tools/price.tool';
import { FundingData } from './tools/funding.tool';

@Injectable()
export class CacheService {
  private priceCache: Map<
    string,
    { data: PriceData | FundingData; timestamp: number }
  > = new Map();
  private readonly CACHE_TTL = 10000; // 10 seconds cache

  set(key: string, value: PriceData | FundingData): void {
    this.priceCache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  get(key: string): PriceData | FundingData | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.priceCache.delete(key);
      return null;
    }

    return cached.data;
  }
}
