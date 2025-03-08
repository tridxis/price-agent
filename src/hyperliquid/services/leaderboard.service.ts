import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  LeaderboardRow,
  LeaderboardResponse,
  LeaderboardProgress,
  LeaderboardUpdateEvent,
} from '../types/leaderboard.type';

/**
 * Service for interacting with Hyperliquid data
 * Provides methods to query and process Hyperliquid market information
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly LEADERBOARD_URL =
    'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
  private leaderboardData: LeaderboardRow[] = [];

  constructor() {}

  async fetchAndStoreLeaderboard(): Promise<void> {
    try {
      this.logger.log('Starting leaderboard data fetch...');

      const response = await axios.get<LeaderboardResponse>(
        this.LEADERBOARD_URL,
        {
          onDownloadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) /
                (progressEvent.total ?? progressEvent.loaded),
            );
            this.logger.log(`Download progress: ${percentCompleted}%`);
          },
        },
      );

      this.logger.log('Download complete, processing data...');

      const rows = response.data.leaderboardRows;
      const totalRows = rows.length;

      this.leaderboardData = [];

      for (let i = 0; i < rows.length; i++) {
        this.leaderboardData.push(rows[i]);

        const percentProcessed = Math.round(((i + 1) * 100) / totalRows);

        if (i % 100 === 0) {
          this.logger.log(`Processing progress: ${percentProcessed}%`);
        }
      }

      this.logger.log(`Successfully stored ${totalRows} leaderboard entries`);
    } catch (error) {
      this.logger.error('Error fetching leaderboard data:', error.message);
      throw error;
    }
  }

  getLeaderboardData(): LeaderboardRow[] {
    return this.leaderboardData;
  }

  getTraderByAddress(address: string): LeaderboardRow | undefined {
    return this.leaderboardData.find(
      (row) => row.ethAddress.toLowerCase() === address.toLowerCase(),
    );
  }

  getTopTraders(limit = 10): LeaderboardRow[] {
    return [...this.leaderboardData]
      .sort((a, b) => parseFloat(b.accountValue) - parseFloat(a.accountValue))
      .slice(0, limit);
  }
}
