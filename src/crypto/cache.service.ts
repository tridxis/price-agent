import { Injectable } from '@nestjs/common';
import { CryptoPrice } from './price-data.service';

@Injectable()
export class CacheService {
  private priceCache: Map<string, { data: CryptoPrice; timestamp: number }> =
    new Map();
  private readonly CACHE_TTL = 10000; // 10 seconds cache

  set(key: string, value: CryptoPrice): void {
    this.priceCache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  get(key: string): CryptoPrice | null {
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
