import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface QuestionIntent {
  type: 'price' | 'funding' | 'comparison' | 'trend' | 'unknown';
  targets: string[];
  action: 'highest' | 'lowest' | 'compare' | 'up' | 'down' | null;
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

  constructor(private readonly httpService: HttpService) {
    // console.log(this.BERT_API);
    if (!this.BERT_API) {
      this.logger.warn(
        'BERT_API_URL not set, falling back to rule-based analysis',
      );
    }
  }

  async analyzeQuestion(question: string): Promise<QuestionIntent> {
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
        intent.type = 'trend';
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
}
