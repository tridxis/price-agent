import * as chrono from 'chrono-node';

export type TechnicalTerm =
  | 'ath'
  | 'atl'
  | 'dip'
  | 'peak'
  | 'trend'
  | 'ma'
  | 'rsi'
  | 'support'
  | 'resistance';

export interface PriceQueryType {
  type: 'date' | 'extremum' | 'technical';
  symbol: string;
  date?: Date;
  isMonth?: boolean;
  priceType?: 'highest' | 'lowest';
  technicalType?: TechnicalTerm;
  technicalPeriod?: number;
}

export class PriceQueryParser {
  static parse(question: string): PriceQueryType | null {
    return this.matchDateQuery(question);
  }

  private static matchDateQuery(question: string): PriceQueryType | null {
    // First extract the symbol and price type
    const symbolMatch = question.match(/(\w+)\s+price/i);
    if (!symbolMatch) return null;

    const symbol = symbolMatch[1].toUpperCase();

    // Check for highest/lowest
    const priceMatch = question.match(/\b(highest|lowest)\b/i);
    const priceType = priceMatch?.[1].toLowerCase() as
      | 'highest'
      | 'lowest'
      | undefined;

    // Parse the date using chrono
    const parsedDates = chrono.parse(question);
    if (parsedDates.length === 0) {
      // If no date but has highest/lowest, treat as extremum query
      if (priceType) {
        return {
          type: 'extremum',
          symbol,
          priceType,
        };
      }
      return null;
    }

    const parsedDate = parsedDates[0];
    const date = parsedDate.start.date();
    const isMonth = !parsedDate.start.isCertain('day');

    // If it's a year-only query, set to January 1st
    if (!parsedDate.start.isCertain('month')) {
      date.setMonth(0);
      date.setDate(1);
    }

    return {
      type: 'date',
      symbol,
      date,
      isMonth: isMonth || !parsedDate.start.isCertain('month'),
      priceType,
    };
  }
}
