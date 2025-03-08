import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { LeaderboardService } from './services/leaderboard.service';
import { LeaderboardSyncJob } from './jobs/leaderboard-sync.job';
import { TraderAnalysisService } from './services/trader-analysis.service';
import { TraderController } from './controllers/trader.controller';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [TraderController],
  providers: [LeaderboardService, LeaderboardSyncJob, TraderAnalysisService],
  exports: [LeaderboardService, TraderAnalysisService],
})
export class HyperliquidModule {}
