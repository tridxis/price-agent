import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import {
  CoinListService,
  CacheService,
  HistoricalDataService,
} from './services';
import { PriceTool, FundingTool, PathRAGTool } from './tools';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
  ],
  providers: [
    CoinListService,
    CacheService,
    HistoricalDataService,
    PriceTool,
    FundingTool,
    PathRAGTool,
  ],
  exports: [
    CoinListService,
    CacheService,
    HistoricalDataService,
    PriceTool,
    FundingTool,
    PathRAGTool,
  ],
})
export class SharedModule {}
