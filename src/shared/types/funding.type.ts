export interface ExchangeFunding {
  exchange: string;
  fundingRate: number;
  timestamp: number;
  nextFundingTime: number;
}

export interface FundingData {
  symbol: string;
  rates: ExchangeFunding[];
  averageRate: number;
}
