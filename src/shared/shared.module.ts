import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
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
    CacheService,
    CoinListService,
    HistoricalDataService,
    {
      provide: PriceTool,
      useFactory: (httpService: HttpService, cacheService: CacheService) => {
        return new PriceTool(httpService, cacheService);
      },
      inject: [HttpService, CacheService],
    },
    {
      provide: FundingTool,
      useFactory: (httpService: HttpService, cacheService: CacheService) => {
        return new FundingTool(httpService, cacheService);
      },
      inject: [HttpService, CacheService],
    },
  ],
  exports: [
    CacheService,
    CoinListService,
    HistoricalDataService,
    PriceTool,
    FundingTool,
  ],
})
export class SharedModule {}
