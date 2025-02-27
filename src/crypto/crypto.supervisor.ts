import { Injectable } from '@nestjs/common';
import { PriceTool, PriceData } from './tools/price.tool';
import { FundingTool, FundingData } from './tools/funding.tool';

@Injectable()
export class CryptoSupervisor {
  constructor(
    private readonly priceTool: PriceTool,
    private readonly fundingTool: FundingTool,
  ) {}

  async getPrice(symbol: string): Promise<PriceData> {
    return this.priceTool.getPrices(symbol);
  }

  async getFunding(symbol: string): Promise<FundingData> {
    return this.fundingTool.getFundingRates(symbol);
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
