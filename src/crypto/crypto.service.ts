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

interface AIResponse {
  response: string;
  timestamp: number;
}

// Define a discriminated union type for different data types
type CryptoData =
  | { type: 'price'; data: PriceData }
  | { type: 'funding'; data: FundingData }
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
      You are a helpful cryptocurrency expert. Use the following price and funding rate data to answer the user's question.
      Available cryptocurrencies: {symbols}
      
      Current prices and funding rates:
      {context}
      
      Question: {question}
      
      Please provide a clear and concise answer based on the available data. 
      For funding rates:
      - Positive rates mean longs pay shorts
      - Negative rates mean shorts pay longs
      - When comparing rates, consider the average rate across exchanges
      - Higher funding rates indicate stronger bullish sentiment
      - Lower/negative rates indicate stronger bearish sentiment
    `);

    this.priceRAG = this.ragManager.getPriceRAG();
  }

  async processQuestion(question: string, useRAG = true): Promise<string> {
    try {
      const intent = await this.nlpTool.analyzeQuestion(question);
      const symbols = this.getSymbolsFromIntent(intent);
      console.log('Symbols:', symbols);
      if (symbols.length === 0) return this.getAvailableCoinsMessage();

      const cacheKey = this.generateCacheKey(question, symbols, intent);
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached;

      const data = await this.getRequiredData(intent, symbols, 0, useRAG);
      const response = await this.generateResponse(question, symbols, data);

      this.cacheResponse(cacheKey, response);
      return response;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to process question: ${err.message}`);
      return 'Sorry, I encountered an error while fetching cryptocurrency prices.';
    }
  }

  private async getRequiredData(
    intent: QuestionIntent,
    symbols: string[],
    retryCount = 0,
    useRAG = true,
  ): Promise<CryptoData[]> {
    const maxRetries = 2;
    const isHistoricalQuery =
      intent.type === 'trend' || intent.timeframe !== 'current';

    // Use RAG only for historical queries
    if (isHistoricalQuery && useRAG) {
      const ragResults = this.searchRAG(intent);
      if (ragResults.length > 0) {
        return ragResults;
      }
    }

    const needsFunding = this.checkIfNeedsFunding(intent.type);

    // Get cached data
    const results = symbols.map((symbol) => {
      try {
        if (needsFunding) {
          if (intent.type === 'funding') {
            const funding = this.cacheService.get(
              `funding_${symbol}`,
              'funding',
            ) as FundingData;
            return funding
              ? ({ type: 'funding', data: funding } as const)
              : null;
          } else {
            const price = this.cacheService.get(
              `price_${symbol}`,
              'price',
            ) as PriceData;
            const funding = this.cacheService.get(
              `funding_${symbol}`,
              'funding',
            ) as FundingData;
            return price && funding
              ? ({ type: 'combined', data: { price, funding } } as const)
              : null;
          }
        } else {
          const price = this.cacheService.get(
            `price_${symbol}`,
            'price',
          ) as PriceData;
          return price ? ({ type: 'price', data: price } as const) : null;
        }
      } catch {
        return null;
      }
    });

    // If we have all data from cache
    if (!results.includes(null)) {
      const validResults = results.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );
      return validResults;
    }

    // If we've retried too many times, return what we have
    if (retryCount >= maxRetries) {
      const validResults = results.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );
      return validResults;
    }

    // Update missing data and retry
    await this.cryptoSupervisor.batchUpdateData(symbols);
    return this.getRequiredData(intent, symbols, retryCount + 1, useRAG);
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
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.responseCache.delete(key);
      return null;
    }

    return cached.response;
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
    return `${question}_${symbols.sort().join('_')}_${intent.type}`;
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
    return `Available cryptocurrencies: ${availableCoins}, and more. Please specify one.`;
  }

  private async generateResponse(
    question: string,
    symbols: string[],
    data: CryptoData[],
  ): Promise<string> {
    const query = PriceQueryParser.parse(question);
    console.log('query', query);

    if (query) {
      const {
        symbol,
        date,
        isMonth,
        priceType,
        type,
        technicalType,
        technicalPeriod,
      } = query;
      const { startDate, lastUpdate, isReady } =
        this.ragManager.getDataAvailability();

      if (!isReady) {
        return 'Historical price data is being loaded. Please try again in a few minutes.';
      }

      if (type === 'technical') {
        const analysis = this.ragManager.getTechnicalAnalysis(
          symbol,
          technicalType!,
          technicalPeriod || 14,
        );

        if (analysis) {
          if ('trend' in analysis) {
            return analysis.description;
          }
          if ('value' in analysis) {
            return `${symbol} ${technicalType?.toUpperCase()}: ${analysis.value.toFixed(2)} (${analysis.description})`;
          }
          if ('support' in analysis) {
            return `${symbol} Support: $${analysis.support.toLocaleString()}, Resistance: $${analysis.resistance.toLocaleString()}`;
          }
          if ('prices' in analysis) {
            const dateStr = new Date(
              analysis.prices[0].timestamp,
            ).toLocaleDateString();
            return `The ${technicalType} of ${symbol} was $${analysis.averagePrice.toLocaleString()} on ${dateStr}`;
          }
        }
        return `Could not calculate ${technicalType} for ${symbol}`;
      }

      if (type === 'date' && date) {
        if (date > new Date()) {
          return `I cannot provide price information for future dates. The requested date (${date.toLocaleDateString()}) is in the future.`;
        }

        if (startDate && date < startDate) {
          return `Historical price data for ${symbol} on ${date.toLocaleDateString()} is not available. Data is available from ${startDate.toLocaleDateString()} onwards.`;
        }

        if (isMonth) {
          if (date.getDate() === 1 && date.getMonth() === 0 && priceType) {
            // Year query with highest/lowest
            const price = this.ragManager.searchByYear(
              symbol,
              date.getFullYear(),
              priceType,
            );
            if (price) {
              const dateStr = new Date(
                price.prices[0].timestamp,
              ).toLocaleDateString();
              return `The ${priceType} price of ${symbol} in ${date.getFullYear()} was $${price.averagePrice.toLocaleString()} on ${dateStr} (Data last updated: ${lastUpdate.toLocaleString()})`;
            }
          }

          const prices = this.ragManager.searchByMonth(
            symbol,
            date.getFullYear(),
            date.getMonth() + 1,
            priceType,
          );
          if (prices.length > 0) {
            if (priceType) {
              const dateStr = new Date(
                prices[0].prices[0].timestamp,
              ).toLocaleDateString();
              return `The ${priceType} price of ${symbol} in ${date.toLocaleString(
                'default',
                { month: 'long', year: 'numeric' },
              )} was $${prices[0].averagePrice.toLocaleString()} on ${dateStr} (Data last updated: ${lastUpdate.toLocaleString()})`;
            }
            const avgPrice =
              prices.reduce((sum, p) => sum + p.averagePrice, 0) /
              prices.length;
            return `The average price of ${symbol} in ${date.toLocaleString(
              'default',
              { month: 'long', year: 'numeric' },
            )} was $${avgPrice.toLocaleString()} (Data last updated: ${lastUpdate.toLocaleString()})`;
          }
        } else {
          const price = this.ragManager.searchByDate(symbol, date);
          if (price) {
            return `The price of ${symbol} on ${date.toLocaleDateString()} was $${price.averagePrice.toLocaleString()} (Data last updated: ${lastUpdate.toLocaleString()})`;
          }
        }

        return `No price data available for ${symbol} on ${date.toLocaleDateString()}. Data might be missing for this specific date.`;
      }

      // Only use LLM for non-technical, non-date queries
      const context = this.formatResponse(data);
      const symbolList = symbols.join(', ').toUpperCase();

      const formattedPrompt = await this.promptTemplate.format({
        symbols: symbolList,
        context,
        question,
      });

      const response = await this.llm.invoke(formattedPrompt);
      return String(response.content as string);
    }

    return 'Invalid query format. Please specify a date or a price/trend query.';
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

  private searchRAG(intent: QuestionIntent): CryptoData[] {
    const results: CryptoData[] = [];
    const timeRange = this.getTimeRangeFromIntent(intent);

    console.log('intent', intent);

    for (const symbol of intent.targets) {
      const upperSymbol = symbol.toUpperCase();

      if (intent.type === 'trend') {
        // Search for historical data to analyze trends
        const priceHistory = this.priceRAG.search(['prices', upperSymbol], {
          timeRange,
          trend: intent.action || 'stable',
        });
        console.log(priceHistory);
        if (priceHistory.length > 0) {
          results.push({
            type: 'price',
            data: this.analyzeTrend(priceHistory),
          });
        }
      } else {
        // Regular price/funding queries
        const latestData = this.priceRAG.search(['prices', upperSymbol])[0];
        if (latestData) {
          results.push({ type: 'price', data: latestData });
        }
      }
    }

    return results;
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

  private analyzeTrend(priceHistory: PriceData[]): PriceData {
    // Implement trend analysis logic here
    return priceHistory[Math.floor(priceHistory.length / 2)];
  }
}
