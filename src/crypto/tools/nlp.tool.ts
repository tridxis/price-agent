import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CoinListService } from '../coin-list.service';

export interface QuestionIntent {
  type: 'price' | 'funding' | 'comparison' | 'trend' | 'unknown' | 'technical';
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
    | null;
  timeframe: 'current' | '1h' | '24h' | '7d';
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
    const symbols = this.extractSymbols(question);

    // Check for technical analysis patterns first
    if (this.technicalPatterns.trend.test(questionLower)) {
      return {
        type: 'technical',
        action: 'trend',
        targets: symbols,
        timeframe: this.extractTimeframe(questionLower),
      };
    }

    if (this.technicalPatterns.support.test(questionLower)) {
      console.log('Support pattern detected', symbols);
      return {
        type: 'technical',
        action: 'support',
        targets: symbols,
        timeframe: 'current',
      };
    }

    if (this.technicalPatterns.rsi.test(questionLower)) {
      return {
        type: 'technical',
        action: 'rsi',
        targets: symbols,
        timeframe: 'current',
      };
    }

    if (this.technicalPatterns.ma.test(questionLower)) {
      return {
        type: 'technical',
        action: 'ma',
        targets: symbols,
        timeframe: 'current',
      };
    }

    if (this.technicalPatterns.extrema.test(questionLower)) {
      return {
        type: 'technical',
        action: 'extrema',
        targets: symbols,
        timeframe: this.extractTimeframe(questionLower),
      };
    }

    try {
      const headers = {
        Authorization: `Bearer ${this.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      };

      const { data } = await firstValueFrom(
        this.httpService.post<BertResponse>(
          this.BERT_API,
          {
            inputs: `${question}`,
            parameters: {
              candidate_labels: [
                'asking about price',
                'asking about funding rate',
                'comparing funding rates',
                'finding highest funding rate',
                'finding lowest funding rate',
                'analyzing market trend',
                'analyzing technical indicators',
                'finding support resistance',
                'calculating RSI',
                'checking moving average',
                'finding price extremes',
              ],
            },
            options: {
              wait_for_model: true,
            },
          },
          { headers },
        ),
      );

      // console.log('API Response:', data); // Debug log
      return this.mapBertResponseToIntent(data);
    } catch (error) {
      this.logger.warn(
        `NLP analysis failed: ${error}, falling back to rule-based analysis`,
      );
      return this.fallbackAnalysis(question);
    }
  }

  private mapBertResponseToIntent(response: BertResponse): QuestionIntent {
    const intent: QuestionIntent = {
      type: 'unknown',
      targets: [],
      action: null,
      timeframe: 'current',
    };

    const topScore = Math.max(...response.scores);
    const topLabel = response.labels[response.scores.indexOf(topScore)];

    // console.log('Top Label:', topLabel, 'Score:', topScore); // Debug log

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
    }

    // console.log('Mapped Intent:', intent); // Debug log
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

  private extractSymbols(question: string): string[] {
    const words = question.toUpperCase().split(/\s+/);
    const supportedCoins = this.coinListService.getSupportedCoins();

    // Find all supported coin symbols in the question
    const foundSymbols = words.filter((word) =>
      supportedCoins.some(
        (coin) =>
          coin.symbol.toUpperCase() === word ||
          coin.symbol.toUpperCase() === word.replace(/[.,!?:;'"(){}[\]]+$/, ''), // Handle all common punctuation
      ),
    );

    console.log('Found symbols:', foundSymbols);

    // If no symbols found, try to find partial matches
    if (foundSymbols.length === 0) {
      const partialMatches = words.filter((word) =>
        supportedCoins.some((coin) => {
          const cleanWord = word.replace(/[.,!?:;'"(){}[\]]+/g, ''); // Clean all punctuation
          return (
            cleanWord.includes(coin.symbol) || coin.symbol.includes(cleanWord)
          );
        }),
      );
      if (partialMatches.length > 0) {
        return [partialMatches[0]]; // Return first partial match
      }
    }

    console.log('Found symbols:', foundSymbols);
    return foundSymbols;
  }

  private extractTimeframe(question: string): 'current' | '1h' | '24h' | '7d' {
    // Implementation of extractTimeframe method
    return 'current';
  }
}
