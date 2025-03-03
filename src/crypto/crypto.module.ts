import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
// import { PriceDataService } from './price-data.service';
import { CoinListService } from './coin-list.service';
import { CacheService } from './cache.service';
import { PriceTool } from './tools/price.tool';
import { CryptoSupervisor } from './crypto.supervisor';
import { FundingTool } from './tools/funding.tool';
import { NLPTool } from './tools/nlp.tool';
import { HistoricalDataService } from './historical-data.service';
import { RAGManagerService } from './rag-manager.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [CryptoController],
  providers: [
    CryptoService,
    CoinListService,
    CacheService,
    PriceTool,
    FundingTool,
    CryptoSupervisor,
    NLPTool,
    HistoricalDataService,
    RAGManagerService,
  ],
})
export class CryptoModule {}
