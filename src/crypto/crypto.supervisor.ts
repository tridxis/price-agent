import { Injectable, Logger } from '@nestjs/common';
import { PriceTool, PriceData } from './tools/price.tool';
import { FundingTool, FundingData } from './tools/funding.tool';
import { CacheService } from './cache.service';
import { CoinListService } from './coin-list.service';

@Injectable()
export class CryptoSupervisor {
  private readonly logger = new Logger(CryptoSupervisor.name);
  private readonly BATCH_SIZE = 10; // Increased batch size
  private isUpdating = false;
  private lastBatchUpdate = 0;
  private readonly BATCH_COOLDOWN = 30000; // 30 seconds cooldown

  constructor(
    private readonly priceTool: PriceTool,
    private readonly fundingTool: FundingTool,
    private readonly cacheService: CacheService,
    private readonly coinListService: CoinListService,
  ) {}

  async batchUpdateData(symbols: string[]): Promise<void> {
    if (
      this.isUpdating ||
      Date.now() - this.lastBatchUpdate < this.BATCH_COOLDOWN
    ) {
      return;
    }

    try {
      this.isUpdating = true;

      // Get cached data first
      const [priceData, fundingData] = await Promise.all([
        this.priceTool.getAllPrices(),
        this.fundingTool.getAllFundingRates(),
      ]);

      // Only update missing or stale data
      const missingSymbols = symbols.filter(
        (symbol) =>
          !priceData.find((p) => p.symbol === symbol) ||
          !fundingData.find((f) => f.symbol === symbol),
      );

      if (missingSymbols.length === 0) {
        return;
      }

      // Process in larger batches
      for (let i = 0; i < missingSymbols.length; i += this.BATCH_SIZE) {
        const batch = missingSymbols.slice(i, i + this.BATCH_SIZE);
        await Promise.all([
          this.batchUpdatePrices(batch),
          this.batchUpdateFunding(batch),
        ]);
      }

      this.lastBatchUpdate = Date.now();
    } finally {
      this.isUpdating = false;
    }
  }

  private async batchUpdatePrices(symbols: string[]): Promise<void> {
    try {
      await Promise.all(
        symbols.map(async (symbol) => {
          const data = await this.priceTool.getPrices(symbol);
          this.cacheService.set(symbol, data, 'price');
        }),
      );
    } catch (error) {
      this.logger.error(`Batch price update failed: ${error}`);
    }
  }

  private async batchUpdateFunding(symbols: string[]): Promise<void> {
    try {
      await Promise.all(
        symbols.map(async (symbol) => {
          const data = await this.fundingTool.getFundingRates(symbol);
          this.cacheService.set(symbol, data, 'funding');
        }),
      );
    } catch (error) {
      this.logger.error(`Batch funding update failed: ${error}`);
    }
  }

  async getPrice(symbol: string): Promise<PriceData> {
    const cached = this.cacheService.get(symbol, 'price') as PriceData;
    if (cached) return cached;

    const data = await this.priceTool.getPrices(symbol);
    this.cacheService.set(symbol, data, 'price');
    return data;
  }

  async getFunding(symbol: string): Promise<FundingData> {
    const cached = this.cacheService.get(symbol, 'funding') as FundingData;
    if (cached) return cached;

    const data = await this.fundingTool.getFundingRates(symbol);
    this.cacheService.set(symbol, data, 'funding');
    return data;
  }

  async getPriceAndFunding(symbol: string): Promise<{
    price: PriceData;
    funding: FundingData;
  }> {
    const [price, funding] = await Promise.all([
      this.getPrice(symbol),
      this.getFunding(symbol),
    ]);
    return { price, funding };
  }
}
