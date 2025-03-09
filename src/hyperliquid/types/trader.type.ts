export interface AssetPosition {
  position: {
    coin: string;
    cumFunding: {
      allTime: string;
      sinceChange: string;
      sinceOpen: string;
    };
    entryPx: string;
    leverage: {
      rawUsd: string;
      type: 'isolated' | 'cross';
      value: number;
    };
    liquidationPx: string;
    marginUsed: string;
    maxLeverage: number;
    positionValue: string;
    returnOnEquity: string;
    szi: string;
    unrealizedPnl: string;
  };
  type: 'oneWay';
}

export interface MarginSummary {
  accountValue: string;
  totalMarginUsed: string;
  totalNtlPos: string;
  totalRawUsd: string;
}

export interface AccountSummary {
  assetPositions: AssetPosition[];
  crossMaintenanceMarginUsed: string;
  crossMarginSummary: MarginSummary;
  marginSummary: MarginSummary;
  time: number;
  withdrawable: string;
}

export interface Fill {
  closedPnl: string;
  coin: string;
  crossed: boolean;
  dir: string;
  hash: string;
  oid: number;
  px: string;
  side: string;
  startPosition: string;
  sz: string;
  time: number;
  fee: string;
  feeToken: string;
  builderFee?: string;
  tid: number;
}

export interface OpenOrder {
  coin: string;
  limitPx: string;
  oid: number;
  side: string;
  sz: string;
  timestamp: number;
}

export interface Trade {
  coin: string;
  side: string;
  totalSize: number;
  avgPrice: number;
  closedPnl?: number;
  time: number;
  // fills: Fill[];
}

export interface TraderAnalysis {
  address: string;
  accountSummary: AccountSummary;
  recentTrades: Trade[];
  openOrders: OpenOrder[];
  analysis: string;
}
