import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { SharedModule } from '../shared/shared.module';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { CryptoSupervisor } from './crypto.supervisor';
import { NLPTool } from './tools/nlp.tool';
import { RAGManagerService } from './rag-manager.service';
import { TechnicalAnalysisService } from './technical-analysis.service';
import { PricePredictionService } from './price-prediction.service';

@Module({
  imports: [HttpModule, SharedModule, ScheduleModule.forRoot()],
  controllers: [CryptoController],
  providers: [
    CryptoService,
    CryptoSupervisor,
    NLPTool,
    RAGManagerService,
    TechnicalAnalysisService,
    PricePredictionService,
  ],
  exports: [CryptoSupervisor],
})
export class CryptoModule {}
