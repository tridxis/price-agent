import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { LeaderboardService } from './services/leaderboard.service';
import { LeaderboardSyncJob } from './jobs/leaderboard-sync.job';
import { TradingMonitorJob } from './jobs/trading-monitor.job';
import { TraderAnalysisService } from './services/trader-analysis.service';
import { TradingAgentService } from './services/trading-agent.service';
import { TraderController } from './controllers/trader.controller';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [HttpModule, ConfigModule, SharedModule],
  controllers: [TraderController],
  providers: [
    LeaderboardService,
    LeaderboardSyncJob,
    TradingMonitorJob,
    TraderAnalysisService,
    TradingAgentService,
  ],
  exports: [LeaderboardService, TraderAnalysisService, TradingAgentService],
})
export class HyperliquidModule {}
