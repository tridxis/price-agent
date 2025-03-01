import { Injectable, OnModuleInit } from '@nestjs/common';
import { PriceData } from './tools/price.tool';
import { FundingData } from './tools/funding.tool';

interface CachedData {
  data: PriceData | FundingData;
  timestamp: number;
}

@Injectable()
export class CacheService implements OnModuleInit {
  private priceCache: Map<string, CachedData> = new Map();
  private fundingCache: Map<string, CachedData> = new Map();
  private readonly PRICE_CACHE_TTL = 10000; // 10 seconds for prices
  private readonly FUNDING_CACHE_TTL = 60000; // 1 minute for funding rates
  private batchInProgress = false;
  private lastBatchUpdate = 0;
  private readonly BATCH_COOLDOWN = 30000; // 30 seconds between batch updates

  async onModuleInit() {
    // Initialize cache on startup
    await this.updateBatchCache();
  }

  set(
    key: string,
    value: PriceData | FundingData,
    type: 'price' | 'funding',
  ): void {
    const cache = type === 'price' ? this.priceCache : this.fundingCache;
    cache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  get(key: string, type: 'price' | 'funding'): PriceData | FundingData | null {
    const cache = type === 'price' ? this.priceCache : this.fundingCache;
    const ttl =
      type === 'price' ? this.PRICE_CACHE_TTL : this.FUNDING_CACHE_TTL;

    const cached = cache.get(key);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > ttl;
    if (isExpired) {
      cache.delete(key);
      return null;
    }

    return cached.data;
  }

  async updateBatchCache(): Promise<void> {
    if (
      this.batchInProgress ||
      Date.now() - this.lastBatchUpdate < this.BATCH_COOLDOWN
    ) {
      return;
    }

    this.batchInProgress = true;
    try {
      // Batch update logic will be implemented in CryptoSupervisor
      this.lastBatchUpdate = Date.now();
    } finally {
      this.batchInProgress = false;
    }
  }

  getAllCachedSymbols(type: 'price' | 'funding'): string[] {
    const cache = type === 'price' ? this.priceCache : this.fundingCache;
    return Array.from(cache.keys());
  }
}
