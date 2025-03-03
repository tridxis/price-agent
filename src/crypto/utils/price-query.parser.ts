import * as chrono from 'chrono-node';

interface PriceQueryType {
  type: 'date' | 'extremum' | 'technical';
  symbol: string;
  date?: Date;
  isMonth?: boolean;
  priceType?: 'highest' | 'lowest';
  technicalType?: TechnicalTerm;
  technicalPeriod?: number;
}

export type CryptoTerm = 'ath' | 'atl' | 'dip' | 'peak';
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

export class PriceQueryParser {
  private static readonly CRYPTO_TERMS: Record<
    CryptoTerm,
    { type: 'highest' | 'lowest'; description: string }
  > = {
    ath: { type: 'highest', description: 'All-Time High' },
    atl: { type: 'lowest', description: 'All-Time Low' },
    dip: { type: 'lowest', description: 'Local Low' },
    peak: { type: 'highest', description: 'Local High' },
  };

  private static readonly TECHNICAL_TERMS: Record<
    TechnicalTerm,
    { type: string; description: string }
  > = {
    ath: { type: 'highest', description: 'All-Time High' },
    atl: { type: 'lowest', description: 'All-Time Low' },
    dip: { type: 'lowest', description: 'Local Low' },
    peak: { type: 'highest', description: 'Local High' },
    trend: { type: 'trend', description: 'Price Trend' },
    ma: { type: 'ma', description: 'Moving Average' },
    rsi: { type: 'rsi', description: 'Relative Strength Index' },
    support: { type: 'support', description: 'Support Level' },
    resistance: { type: 'resistance', description: 'Resistance Level' },
  };

  static parse(question: string): PriceQueryType | null {
    // First try to match crypto-specific terms
    const cryptoTermMatch = this.matchCryptoTerm(question);
    if (cryptoTermMatch) {
      return cryptoTermMatch;
    }

    // Then try to match regular date queries
    return this.matchDateQuery(question);
  }

  private static matchCryptoTerm(question: string): PriceQueryType | null {
    // Updated pattern to handle both crypto and technical terms
    const termPattern = new RegExp(
      `(?:what(?:'s| is| was)?\\s+)?(?:the\\s+)?(${Object.keys(this.TECHNICAL_TERMS).join('|')})(?:\\s+(?:of|for|price|level|analysis))?\\s*(?:of|for)?\\s*(\\w+)`,
      'i',
    );
    const match = question.match(termPattern);
    if (!match) return null;

    const [, term, symbol] = match;
    const termLower = term.toLowerCase() as TechnicalTerm;
    const termInfo = this.TECHNICAL_TERMS[termLower];

    // Extract period if specified (e.g., "14-day RSI")
    const periodMatch = question.match(/(\d+)(?:\s*-?\s*day)/i);
    const period = periodMatch ? parseInt(periodMatch[1], 10) : undefined;

    return {
      type: 'technical',
      symbol: symbol.toUpperCase(),
      technicalType: termLower,
      technicalPeriod: period,
    };
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
