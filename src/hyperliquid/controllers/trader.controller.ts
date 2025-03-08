import { Controller, Get, Param } from '@nestjs/common';
import { TraderAnalysisService } from '../services/trader-analysis.service';
import { TraderAnalysis } from '../types/trader.type';

@Controller('trader')
export class TraderController {
  constructor(private readonly traderAnalysisService: TraderAnalysisService) {}

  @Get(':address')
  async analyzeTrader(
    @Param('address') address: string,
  ): Promise<TraderAnalysis> {
    return this.traderAnalysisService.analyzeTrader(address);
  }
}
