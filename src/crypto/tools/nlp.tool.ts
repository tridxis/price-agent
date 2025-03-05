import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CoinListService } from '../coin-list.service';
import * as chrono from 'chrono-node';

export interface QuestionIntent {
  type:
    | 'price'
    | 'funding'
    | 'comparison'
    | 'trend'
    | 'unknown'
    | 'technical'
    | 'prediction';
  targets: string[];
  action:
    | 'highest'
    | 'lowest'
    | 'compare'
    | 'up'
    | 'down'
    | 'trend'
    | 'support'
    | 'rsi'
    | 'ma'
    | 'extrema'
    | 'predict'
    | null;
  timeframe: 'current' | '1h' | '24h' | '7d';
}

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

interface PriceQuery {
  type: 'date' | 'extremum' | 'technical';
  symbol: string;
  date?: Date;
  isMonth?: boolean;
  priceType?: 'highest' | 'lowest';
  technicalType?: TechnicalTerm;
  technicalPeriod?: number;
}

interface BertResponse {
  labels: string[];
  scores: number[];
  sequence: string;
}

@Injectable()
export class NLPTool {
  private readonly logger = new Logger(NLPTool.name);
  private readonly BERT_API =
    'https://api-inference.huggingface.co/models/facebook/bart-large-mnli';
  private readonly HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

  private readonly technicalPatterns = {
    trend: /\b(trend|bullish|bearish)\b/i,
    support: /\b(support|resistance)\b/i,
    rsi: /\brsi\b/i,
    ma: /\b(ma|moving average)\b/i,
    extrema: /\b(ath|atl|dip|peak)\b/i,
  };

  private readonly TECHNICAL_TERMS: Record<
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

  constructor(
    private readonly httpService: HttpService,
    private readonly coinListService: CoinListService,
  ) {
    if (!this.BERT_API) {
      this.logger.warn(
        'BERT_API_URL not set, falling back to rule-based analysis',
      );
    }
  }

  async analyzeQuestion(question: string): Promise<QuestionIntent> {
    const questionLower = question.toLowerCase();

    // Check for prediction keywords first
    if (this.hasPredictionKeywords(questionLower)) {
      const symbols = await this.extractSymbols(question);
      return {
        type: 'prediction',
        action: 'predict',
        targets: symbols,
        timeframe: 'current',
      };
    }

    // Try technical analysis next
    const technicalMatch = this.matchTechnicalQuery(question);
    if (technicalMatch) {
      return {
        type: 'technical',
        action: technicalMatch.technicalType as QuestionIntent['action'],
        targets: [technicalMatch.symbol],
        timeframe: this.extractTimeframe(questionLower),
      };
    }

    // Try date-based queries
    const dateMatch = this.matchDateQuery(question);
    if (dateMatch) {
      return {
        type: dateMatch.type === 'date' ? 'price' : 'technical',
        action: dateMatch.priceType || 'trend',
        targets: [dateMatch.symbol],
        timeframe: this.getTimeframeFromDate(dateMatch.date),
      };
    }

    const symbols = await this.extractSymbols(question);
    return this.analyzeBertResponse(question, symbols);
  }

  private matchTechnicalQuery(question: string): PriceQuery | null {
    const termPattern = new RegExp(
      `(?:what(?:'s| is| was)?\\s+)?(?:the\\s+)?(${Object.keys(this.TECHNICAL_TERMS).join('|')})(?:\\s+(?:of|for|price|level|analysis))?\\s*(?:of|for)?\\s*([\\w\\s]+)`,
      'i',
    );
    const match = question.match(termPattern);
    if (!match) return null;

    const [, term, symbolOrName] = match;
    const termLower = term.toLowerCase() as TechnicalTerm;
    const cleanSymbolOrName = symbolOrName
      .trim()
      .replace(/[.,!?:;'"(){}[\]]+/g, '');

    const periodMatch = question.match(/(\d+)(?:\s*-?\s*day)/i);
    const period = periodMatch ? parseInt(periodMatch[1], 10) : undefined;

    const matchedSymbols = this.extractSymbolsByRegex(cleanSymbolOrName);
    if (matchedSymbols.length === 0) return null;

    return {
      type: 'technical',
      symbol: matchedSymbols[0],
      technicalType: termLower,
      technicalPeriod: period,
    };
  }

  private matchDateQuery(question: string): PriceQuery | null {
    const symbolMatch = question.match(/(\w+)\s+price/i);
    if (!symbolMatch) return null;

    const symbol = symbolMatch[1].toUpperCase();
    const priceMatch = question.match(/\b(highest|lowest)\b/i);
    const priceType = priceMatch?.[1].toLowerCase() as
      | 'highest'
      | 'lowest'
      | undefined;

    const parsedDates = chrono.parse(question);
    if (parsedDates.length === 0) {
      if (priceType) {
        return { type: 'extremum', symbol, priceType };
      }
      return null;
    }

    const parsedDate = parsedDates[0];
    const date = parsedDate.start.date();
    const isMonth = !parsedDate.start.isCertain('day');

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

  private getTimeframeFromDate(date?: Date): QuestionIntent['timeframe'] {
    if (!date) return 'current';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = diff / (1000 * 60 * 60 * 24);

    if (days <= 1) return '24h';
    if (days <= 7) return '7d';
    return 'current';
  }

  private async extractSymbols(question: string): Promise<string[]> {
    // First try regex-based extraction
    const regexSymbols = this.extractSymbolsByRegex(question);
    if (regexSymbols.length > 0 && !this.needsContextualAnalysis(question)) {
      return regexSymbols;
    }

    try {
      // Use BERT for contextual analysis
      const { data } = await firstValueFrom(
        this.httpService.post<BertResponse>(
          this.BERT_API,
          {
            inputs: question,
            parameters: {
              candidate_labels: [
                'mentions specific cryptocurrencies',
                'refers to all cryptocurrencies',
                'excludes specific cryptocurrencies',
                'compares cryptocurrencies',
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${this.HUGGINGFACE_API_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const topLabel =
        data.labels[data.scores.indexOf(Math.max(...data.scores))];
      const supportedCoins = this.coinListService.getSupportedCoins();
      const upperSymbols = supportedCoins.map((coin) =>
        coin.symbol.toUpperCase(),
      );

      switch (topLabel) {
        case 'refers to all cryptocurrencies':
          return upperSymbols;

        case 'excludes specific cryptocurrencies': {
          const excludedSymbols = this.extractSymbolsByRegex(question);
          return upperSymbols.filter(
            (symbol) => !excludedSymbols.includes(symbol),
          );
        }

        case 'mentions specific cryptocurrencies':
          return regexSymbols.length > 0 ? regexSymbols : [upperSymbols[0]]; // Default to first coin if no matches

        default:
          return regexSymbols;
      }
    } catch (error) {
      this.logger.warn(`BERT analysis failed, falling back to regex: ${error}`);
      return regexSymbols;
    }
  }

  private needsContextualAnalysis(question: string): boolean {
    const contextualPatterns = [
      /\b(all|every|any)\b/i,
      /\b(except|but|not|excluding)\b/i,
      /\b(others|rest|remaining)\b/i,
      /\b(like|similar to)\b/i,
    ];

    return contextualPatterns.some((pattern) => pattern.test(question));
  }

  private extractSymbolsByRegex(question: string): string[] {
    const words = question.toUpperCase().split(/\s+/);
    const supportedCoins = this.coinListService.getSupportedCoins();
    const upperSymbols = supportedCoins.map((coin) => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name.toUpperCase(),
    }));

    // First try to match full names
    const foundByName = words.some((word) =>
      upperSymbols.some((coin) => {
        const cleanWord = word.replace(/[.,!?:;'"(){}[\]]+/g, '');
        return coin.name.toLowerCase() === cleanWord.toLowerCase();
      }),
    );

    if (foundByName) {
      const matchedCoins = upperSymbols.filter((coin) =>
        words.some((word) => {
          const cleanWord = word.replace(/[.,!?:;'"(){}[\]]+/g, '');
          return coin.name.toLowerCase() === cleanWord.toLowerCase();
        }),
      );
      return matchedCoins.map((coin) => coin.symbol);
    }

    // Then try to match symbols
    const foundSymbols = words.filter((word) =>
      upperSymbols.some(
        (coin) =>
          coin.symbol === word ||
          coin.symbol === word.replace(/[.,!?:;'"(){}[\]]+$/, ''),
      ),
    );

    // If no direct matches found, try partial matches
    if (foundSymbols.length === 0) {
      const partialMatches = words.filter((word) =>
        upperSymbols.some((coin) => {
          const cleanWord = word.replace(/[.,!?:;'"(){}[\]]+/g, '');
          return (
            cleanWord.includes(coin.symbol) ||
            coin.symbol.includes(cleanWord) ||
            cleanWord.toLowerCase() === coin.name.toLowerCase()
          );
        }),
      );
      if (partialMatches.length > 0) {
        const matchedCoin = upperSymbols.find((coin) =>
          partialMatches.some((word) => {
            const cleanWord = word.replace(/[.,!?:;'"(){}[\]]+/g, '');
            return (
              cleanWord.includes(coin.symbol) ||
              coin.symbol.includes(cleanWord) ||
              cleanWord.toLowerCase() === coin.name.toLowerCase()
            );
          }),
        );
        return matchedCoin ? [matchedCoin.symbol] : [];
      }
    }

    return foundSymbols;
  }

  private extractTimeframe(question: string): 'current' | '1h' | '24h' | '7d' {
    // Implementation of extractTimeframe method
    return 'current';
  }

  private async analyzeBertResponse(
    question: string,
    symbols: string[],
  ): Promise<QuestionIntent> {
    try {
      const headers = {
        Authorization: `Bearer ${this.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      };

      const { data } = await firstValueFrom(
        this.httpService.post<BertResponse>(
          this.BERT_API,
          {
            inputs: question,
            parameters: {
              candidate_labels: [
                'asking about price',
                'asking or comparing about funding rate',
                'analyzing market trend',
                'analyzing technical indicators',
                'finding support resistance',
                'calculating RSI',
                'checking moving average',
                'finding price extremes',
                'predicting future price',
                'forecasting price movement',
              ],
            },
            options: { wait_for_model: true },
          },
          { headers },
        ),
      );

      return this.mapBertResponseToIntent(data, symbols);
    } catch (error) {
      this.logger.warn(
        `NLP analysis failed: ${error}, falling back to rule-based analysis`,
      );
      return this.fallbackAnalysis(question);
    }
  }

  private hasPredictionKeywords(question: string): boolean {
    const keywords = [
      'next day',
      'tomorrow',
      'predict',
      'prediction',
      'forecast',
      'will be',
      'going to be',
    ];
    const questionLower = question.toLowerCase();
    return keywords.some((keyword) => questionLower.includes(keyword));
  }

  private mapBertResponseToIntent(
    response: BertResponse,
    symbols: string[],
  ): QuestionIntent {
    const intent: QuestionIntent = {
      type: 'unknown',
      targets: symbols,
      action: null,
      timeframe: 'current',
    };

    const topScore = Math.max(...response.scores);
    const topLabel = response.labels[response.scores.indexOf(topScore)];

    if (topScore < 0.5) {
      throw new Error('Low confidence score');
    }

    switch (topLabel) {
      case 'asking about price':
        intent.type = 'price';
        break;
      case 'asking about funding rate':
        intent.type = 'funding';
        break;
      case 'comparing funding rates':
        intent.type = 'comparison';
        intent.action = 'compare';
        break;
      case 'finding highest funding rate':
        intent.type = 'funding';
        intent.action = 'highest';
        break;
      case 'finding lowest funding rate':
        intent.type = 'funding';
        intent.action = 'lowest';
        break;
      case 'analyzing market trend':
        intent.type = 'technical';
        intent.action = 'trend';
        break;
      case 'analyzing technical indicators':
        intent.type = 'technical';
        intent.action = 'trend';
        break;
      case 'finding support resistance':
        intent.type = 'technical';
        intent.action = 'support';
        break;
      case 'calculating RSI':
        intent.type = 'technical';
        intent.action = 'rsi';
        break;
      case 'checking moving average':
        intent.type = 'technical';
        intent.action = 'ma';
        break;
      case 'finding price extremes':
        intent.type = 'technical';
        intent.action = 'extrema';
        break;
      case 'predicting future price':
      case 'forecasting price movement':
        intent.type = 'prediction';
        intent.action = 'predict';
        break;
    }

    return intent;
  }

  private fallbackAnalysis(question: string): QuestionIntent {
    const questionLower = question.toLowerCase();

    // Simple rule-based fallback
    const intent: QuestionIntent = {
      type: 'unknown',
      targets: [],
      action: null,
      timeframe: 'current',
    };

    // Check for funding-related keywords
    if (this.hasFundingKeywords(questionLower)) {
      intent.type = 'funding';
      if (this.hasComparisonKeywords(questionLower)) {
        intent.type = 'comparison';
        intent.action = this.getComparisonAction(questionLower);
      }
    }
    // Check for price-related keywords
    else if (this.hasPriceKeywords(questionLower)) {
      intent.type = 'price';
    }

    return intent;
  }

  private hasFundingKeywords(text: string): boolean {
    const keywords = ['funding', 'rate', 'interest', 'perpetual', 'perp'];
    return keywords.some((keyword) => text.includes(keyword));
  }

  private hasComparisonKeywords(text: string): boolean {
    const keywords = [
      'highest',
      'lowest',
      'best',
      'worst',
      'most',
      'least',
      'compare',
    ];
    return keywords.some((keyword) => text.includes(keyword));
  }

  private getComparisonAction(text: string): QuestionIntent['action'] {
    if (
      text.includes('highest') ||
      text.includes('most') ||
      text.includes('best')
    ) {
      return 'highest';
    }
    if (
      text.includes('lowest') ||
      text.includes('least') ||
      text.includes('worst')
    ) {
      return 'lowest';
    }
    return 'compare';
  }

  private hasPriceKeywords(text: string): boolean {
    const keywords = ['price', 'cost', 'worth', 'value'];
    return keywords.some((keyword) => text.includes(keyword));
  }
}
