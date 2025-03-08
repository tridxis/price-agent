import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeaderboardService } from '../services/leaderboard.service';

@Injectable()
export class LeaderboardSyncJob {
  private readonly logger = new Logger(LeaderboardSyncJob.name);

  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async syncLeaderboard() {
    this.logger.log('Starting hourly leaderboard sync');
    await this.leaderboardService.fetchAndStoreLeaderboard();
  }

  // Initial sync on application startup
  async onApplicationBootstrap() {
    this.logger.log('Performing initial leaderboard sync');
    await this.leaderboardService.fetchAndStoreLeaderboard();
  }
}
