export interface WindowPerformance {
  pnl: string;
  roi: string;
  vlm: string;
}

export type TimeWindow = 'day' | 'week' | 'month' | 'allTime';

export interface LeaderboardRow {
  ethAddress: string;
  accountValue: string;
  windowPerformances: [TimeWindow, WindowPerformance][];
  prize: number;
  displayName: string | null;
}

export interface LeaderboardResponse {
  leaderboardRows: LeaderboardRow[];
}

export interface LeaderboardProgress {
  processed: number;
  total: number;
  percent: number;
}

export interface LeaderboardUpdateEvent {
  totalEntries: number;
  timestamp: Date;
}
