import { Injectable, OnModuleInit } from '@nestjs/common';
import { PriceData } from './tools/price.tool';
import { FundingData } from './tools/funding.tool';

interface CachedData {
  data: PriceData | FundingData;
  timestamp: number;
}

type CacheType = 'price' | 'funding';
type CacheData<T extends CacheType> = T extends 'price'
  ? PriceData
  : FundingData;

@Injectable()
export class CacheService implements OnModuleInit {
  private priceCache: Map<string, CachedData> = new Map();
  private fundingCache: Map<string, CachedData> = new Map();
  private readonly PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for prices
  private readonly FUNDING_CACHE_TTL = 60 * 60 * 1000; // 1 hour for funding
  private readonly BATCH_COOLDOWN = 30000; // 30 seconds between batch updates
  private batchInProgress = false;
  private lastBatchUpdate = 0;

  private memoryCache: {
    [K in CacheType]: Map<string, CacheData<K>>;
  } = {
    price: new Map<string, PriceData>(),
    funding: new Map<string, FundingData>(),
  };

  onModuleInit() {
    this.updateBatchCache();
  }

  set<T extends CacheType>(key: string, value: CacheData<T>, type: T): void {
    const cache = type === 'price' ? this.priceCache : this.fundingCache;
    cache.set(key, {
      data: value,
      timestamp: Date.now(),
    });

    const memoryCacheKey = key.replace(`${type}_`, '');
    this.memoryCache[type].set(memoryCacheKey, value);
  }

  get<T extends CacheType>(key: string, type: T): CacheData<T> | null {
    const memoryCacheKey = key.replace(`${type}_`, '');
    const memoryData = this.memoryCache[type].get(memoryCacheKey);
    if (memoryData) return memoryData;

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

    return cached.data as CacheData<T>;
  }

  getAll<T extends CacheType>(type: T): CacheData<T>[] {
    return Array.from(this.memoryCache[type].values());
  }

  updateBatchCache() {
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

  getAllCachedSymbols(type: CacheType): string[] {
    const cache = type === 'price' ? this.priceCache : this.fundingCache;
    return Array.from(cache.keys());
  }
}
