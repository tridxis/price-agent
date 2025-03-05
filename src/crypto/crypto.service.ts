/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { CoinListService } from './coin-list.service';
import { CryptoSupervisor } from './crypto.supervisor';
import { FundingData } from './tools/funding.tool';
import { NLPTool, QuestionIntent } from './tools/nlp.tool';
import { CacheService } from './cache.service';
import { PathRAGTool } from './tools/path-rag.tool';
import { RAGManagerService } from './rag-manager.service';
import * as chrono from 'chrono-node';
import { PriceQueryParser } from './utils/price-query.parser';
import { PriceData } from './types/price.type';
import { TechnicalAnalysisService } from './technical-analysis.service';

interface AIResponse {
  response: string;
  timestamp: number;
}

// Define a discriminated union type for different data types
type CryptoData =
  | { type: 'price'; data: PriceData }
  | { type: 'funding'; data: FundingData }
  | { type: 'technical'; data: any }
  | { type: 'combined'; data: { price: PriceData; funding: FundingData } };

interface DateQueryResult {
  symbol: string;
  date: Date;
  isMonth: boolean;
  priceType?: 'highest' | 'lowest';
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly llm: ChatOpenAI;
  private readonly promptTemplate: PromptTemplate;
  private readonly responseCache: Map<string, AIResponse> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds for AI responses
  private readonly priceRAG: PathRAGTool<PriceData>;
  private readonly fundingRAG: PathRAGTool<FundingData>;

  constructor(
    private readonly cryptoSupervisor: CryptoSupervisor,
    private readonly coinListService: CoinListService,
    private readonly nlpTool: NLPTool,
    private readonly cacheService: CacheService,
    private readonly ragManager: RAGManagerService,
    private readonly technicalAnalysis: TechnicalAnalysisService,
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-3.5-turbo',
      temperature: 0.3,
      maxTokens: 150,
    });

    this.promptTemplate = PromptTemplate.fromTemplate(`
      You are a helpful cryptocurrency expert. Use the following data to answer the user's question.
      Available cryptocurrencies: {symbols}
      
      Data context:
      {context}
      
      Question: {question}
      
      Please provide a clear and concise answer based on the available data.
      For technical analysis:
      - RSI > 70 indicates overbought conditions
      - RSI < 30 indicates oversold conditions
      - Moving averages help identify trends
      - Support/resistance levels indicate key price points
    `);

    this.priceRAG = this.ragManager.getPriceRAG();
  }

  async processQuestion(question: string): Promise<string> {
    try {
      const intent = await this.nlpTool.analyzeQuestion(question);
      if (intent.targets.length === 0 && intent.type !== 'unknown') {
        return this.getAvailableCoinsMessage();
      }

      const cacheKey = this.generateCacheKey(question, intent.targets, intent);
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached;

      const data = await this.getRequiredData(intent);
      const response = await this.generateResponse(
        question,
        intent.targets,
        data,
      );

      this.cacheResponse(cacheKey, response);
      return response;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to process question: ${err.message}`);
      return 'Sorry, I encountered an error while processing your request.';
    }
  }

  private async getRequiredData(intent: QuestionIntent): Promise<CryptoData[]> {
    const results: CryptoData[] = [];

    for (const symbol of intent.targets) {
      switch (intent.type) {
        case 'technical': {
          const data = await this.getTechnicalAnalysis(symbol, intent);
          if (data) results.push({ type: 'technical', data });
          break;
        }
        case 'price': {
          const data = await this.cryptoSupervisor.getPrice(symbol);
          results.push({ type: 'price', data });
          break;
        }
        case 'funding': {
          const data = await this.cryptoSupervisor.getFunding(symbol);
          results.push({ type: 'funding', data });
          break;
        }
        case 'comparison': {
          const [price, funding] = await Promise.all([
            this.cryptoSupervisor.getPrice(symbol),
            this.cryptoSupervisor.getFunding(symbol),
          ]);
          results.push({
            type: 'combined',
            data: { price, funding },
          });
          break;
        }
      }
    }

    return results;
  }

  private checkIfNeedsFunding(questionType: string): boolean {
    const fundingKeywords = [
      'funding',
      'rate',
      'interest',
      'perpetual',
      'perp',
      'long',
      'short',
    ];
    const questionLower = questionType.toLowerCase();
    return fundingKeywords.some((keyword) => questionLower.includes(keyword));
  }

  private getCachedResponse(key: string): string | null {
    const cached = this.responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.response;
    }
    return null;
  }

  private cacheResponse(key: string, response: string): void {
    this.responseCache.set(key, {
      response,
      timestamp: Date.now(),
    });
  }

  private getSymbolsFromIntent(intent: QuestionIntent): string[] {
    // If specific targets are identified, use them
    if (intent.targets.length > 0) {
      return intent.targets;
    }

    // For comparison or funding/price questions, return all supported coins
    if (
      intent.type === 'comparison' ||
      intent.type === 'funding' ||
      intent.type === 'price'
    ) {
      return this.coinListService
        .getSupportedCoins()
        .map((coin) => coin.symbol);
    }

    return [];
  }

  private generateCacheKey(
    question: string,
    symbols: string[],
    intent: QuestionIntent,
  ): string {
    return `${question}:${symbols.join(',')}:${intent.type}:${intent.timeframe}`;
  }

  private formatResponse(data: CryptoData[]): string {
    if (data.length === 0) {
      return 'No data available for the requested symbols. They might not have perpetual contracts.';
    }

    return data
      .map((item) => {
        switch (item.type) {
          case 'funding':
            return this.formatFundingData(item.data);
          case 'price':
            return this.formatPriceData(item.data);
          case 'combined':
            return this.formatCombinedData(item.data);
        }
      })
      .join('\n\n');
  }

  private formatFundingData(data: FundingData): string {
    const fundingList = data.rates
      .map(
        (r) =>
          `${r.exchange}: ${r.fundingRate > 0 ? '+' : ''}${r.fundingRate.toFixed(4)}%`,
      )
      .join('\n  ');
    return `${data.symbol}:\n  Funding Rates:\n  ${fundingList}\n  Average Rate: ${
      data.averageRate > 0 ? '+' : ''
    }${data.averageRate.toFixed(4)}%`;
  }

  private formatPriceData(data: PriceData): string {
    const priceList = data.prices
      .map((p) => `${p.exchange}: $${p.price.toLocaleString()}`)
      .join('\n  ');
    return `${data.symbol}:\n  ${priceList}\n  Average Price: $${data.averagePrice.toLocaleString()}`;
  }

  private formatCombinedData(data: {
    price: PriceData;
    funding: FundingData;
  }): string {
    const priceList = data.price.prices
      .map((p) => `${p.exchange}: $${p.price.toLocaleString()}`)
      .join('\n  ');

    const fundingList =
      '\n  Funding Rates:\n  ' +
      data.funding.rates
        .map(
          (r) =>
            `${r.exchange}: ${r.fundingRate > 0 ? '+' : ''}${r.fundingRate.toFixed(4)}%`,
        )
        .join('\n  ') +
      `\n  Average Rate: ${
        data.funding.averageRate > 0 ? '+' : ''
      }${data.funding.averageRate.toFixed(4)}%`;

    return `${data.price.symbol}:\n  ${priceList}\n  Average Price: $${data.price.averagePrice.toLocaleString()}${fundingList}`;
  }

  private getAvailableCoinsMessage(): string {
    const availableCoins = this.coinListService
      .getSupportedCoins()
      .map((coin) => `${coin.symbol.toUpperCase()}`)
      .join(', ');
    return `Available cryptocurrencies: ${availableCoins}. Please specify one.`;
  }

  private async generateResponse(
    question: string,
    symbols: string[],
    data: CryptoData[],
  ): Promise<string> {
    const context = this.formatDataContext(data);
    const availableSymbols = symbols.join(', ');

    const prompt = await this.promptTemplate.format({
      symbols: availableSymbols,
      context,
      question,
    });

    const response = await this.llm.invoke(prompt);
    return response.content as string;
  }

  private formatDataContext(data: CryptoData[]): string {
    return data
      .map((item) => {
        switch (item.type) {
          case 'price':
            return `${item.data.symbol}: $${item.data.averagePrice.toFixed(2)}`;
          case 'funding':
            return `${item.data.symbol} funding rate: ${(
              item.data.averageRate * 100
            ).toFixed(4)}%`;
          case 'technical':
            return this.formatTechnicalData(item.data);
          case 'combined':
            return `${item.data.price.symbol}: $${item.data.price.averagePrice.toFixed(
              2,
            )} (funding: ${(item.data.funding.averageRate * 100).toFixed(4)}%)`;
        }
      })
      .join('\n');
  }

  private formatTechnicalData(data: any): string {
    if ('trend' in data) {
      return `Trend: ${data.trend} (strength: ${data.strength}%) - ${data.description}`;
    }
    if ('value' in data) {
      return `${data.description}: ${data.value.toFixed(2)}`;
    }
    if ('support' in data) {
      return `Support: $${data.support.toFixed(2)}, Resistance: $${data.resistance.toFixed(2)}`;
    }
    return JSON.stringify(data);
  }

  private async getTechnicalAnalysis(
    symbol: string,
    intent: QuestionIntent,
  ): Promise<any> {
    const period = this.extractPeriod(intent);
    const historicalData = await this.ragManager.getHistoricalData(
      symbol,
      period,
    );

    if (!historicalData || historicalData.length === 0) {
      return null;
    }

    switch (intent.action) {
      case 'trend':
        return this.technicalAnalysis.analyzeTrend(historicalData);
      case 'support':
        return this.technicalAnalysis.findSupportResistance(historicalData);
      case 'rsi':
        return {
          value: this.technicalAnalysis.calculateRSI(
            historicalData.map((d) => d.averagePrice),
            14,
          ),
          description: 'RSI indicates overbought > 70, oversold < 30',
        };
      case 'ma':
        return {
          value: this.technicalAnalysis.calculateMA(
            historicalData.map((d) => d.averagePrice),
            period || 14,
          ),
          description: `${period || 14}-day Moving Average`,
        };
      default:
        return null;
    }
  }

  private extractPeriod(intent: QuestionIntent): number {
    switch (intent.timeframe) {
      case '7d':
        return 7;
      case '24h':
        return 1;
      case '1h':
        return 1 / 24;
      default:
        return 14;
    }
  }

  private parseDateQuery(question: string): DateQueryResult | null {
    // First extract the symbol and price type
    const symbolMatch = question.match(/(\w+)\s+price/i);
    if (!symbolMatch) return null;

    const symbol = symbolMatch[1].toUpperCase();

    // Check for highest/lowest
    const priceType = question
      .match(/\b(highest|lowest)\b/i)?.[1]
      .toLowerCase() as 'highest' | 'lowest' | undefined;

    // Parse the date using chrono
    const parsedDate = chrono.parse(question)[0];
    if (!parsedDate) return null;

    const date = parsedDate.start.date();

    // Determine if it's a month query
    const isMonth = parsedDate.start.isCertain('day') === false;

    // If it's a year-only query, set to January 1st
    if (parsedDate.start.isCertain('month') === false) {
      date.setMonth(0);
      date.setDate(1);
    }

    return {
      symbol,
      date,
      isMonth: isMonth || parsedDate.start.isCertain('month') === false,
      priceType,
    };
  }

  private getOldestAvailableDate(): Date {
    const { startDate } = this.ragManager.getDataAvailability();
    if (startDate) {
      return startDate;
    }
    // Fallback to 1 year ago if no data is available yet
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date;
  }

  private getTimeRangeFromIntent(intent: QuestionIntent): number {
    switch (intent.timeframe) {
      case '1h':
        return 60 * 60 * 1000;
      case '24h':
        return 24 * 60 * 60 * 1000;
      case '7d':
        return 7 * 24 * 60 * 60 * 1000;
      default:
        return 0; // current
    }
  }
}
