import { Injectable, Logger } from '@nestjs/common';
import { PriceTool, PriceData } from './tools/price.tool';
import { FundingTool, FundingData } from './tools/funding.tool';
import { CacheService } from './cache.service';
import { CoinListService } from './coin-list.service';

@Injectable()
export class CryptoSupervisor {
  private readonly logger = new Logger(CryptoSupervisor.name);
  private readonly BATCH_SIZE = 5; // Process 5 symbols at a time

  constructor(
    private readonly priceTool: PriceTool,
    private readonly fundingTool: FundingTool,
    private readonly cacheService: CacheService,
    private readonly coinListService: CoinListService,
  ) {}

  async batchUpdateData(symbols: string[]): Promise<void> {
    // Split symbols into batches
    for (let i = 0; i < symbols.length; i += this.BATCH_SIZE) {
      const batch = symbols.slice(i, i + this.BATCH_SIZE);

      // Process each batch in parallel
      await Promise.all([
        this.batchUpdatePrices(batch),
        this.batchUpdateFunding(batch),
      ]);

      // Small delay between batches to avoid rate limits
      if (i + this.BATCH_SIZE < symbols.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
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
