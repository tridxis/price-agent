import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { CoinListService } from './coin-list.service';
import { CryptoSupervisor } from './crypto.supervisor';
import { PriceData } from './tools/price.tool';
import { FundingData } from './tools/funding.tool';

interface AIResponse {
  response: string;
  timestamp: number;
}

// Define a discriminated union type for different data types
type CryptoData =
  | { type: 'price'; data: PriceData }
  | { type: 'funding'; data: FundingData }
  | { type: 'combined'; data: { price: PriceData; funding: FundingData } };

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly llm: ChatOpenAI;
  private readonly promptTemplate: PromptTemplate;
  private readonly responseCache: Map<string, AIResponse> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds for AI responses

  constructor(
    private readonly cryptoSupervisor: CryptoSupervisor,
    private readonly coinListService: CoinListService,
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-3.5-turbo', // Using a faster model
      temperature: 0.3, // Lower temperature for more consistent responses
      maxTokens: 150, // Limit response length
    });

    this.promptTemplate = PromptTemplate.fromTemplate(`
      You are a helpful cryptocurrency expert. Use the following price and funding rate data to answer the user's question.
      Available cryptocurrencies: {symbols}
      
      Current prices and funding rates:
      {context}
      
      Question: {question}
      
      Please provide a clear and concise answer based on the available data. If asked about funding rates, explain whether they are positive (longs pay shorts) or negative (shorts pay longs).
    `);
  }

  async processQuestion(question: string): Promise<string> {
    try {
      const symbols = this.extractCryptoSymbols(question);
      if (symbols.length === 0) return this.getAvailableCoinsMessage();

      const cacheKey = `${question}_${symbols.sort().join('_')}`;
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached;

      const data = await this.getRequiredData(question, symbols);
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
    question: string,
    symbols: string[],
  ): Promise<CryptoData[]> {
    const needsFunding = this.checkIfNeedsFunding(question);

    if (needsFunding) {
      const combinedData = await Promise.all(
        symbols.map(async (symbol) => {
          const data = await this.cryptoSupervisor.getPriceAndFunding(symbol);
          return { type: 'combined', data } as const;
        }),
      );
      return combinedData;
    }

    const priceData = await Promise.all(
      symbols.map(async (symbol) => {
        const data = await this.cryptoSupervisor.getPrice(symbol);
        return { type: 'price', data } as const;
      }),
    );
    return priceData;
  }

  private checkIfNeedsFunding(question: string): boolean {
    const fundingKeywords = [
      'funding',
      'rate',
      'interest',
      'perpetual',
      'perp',
      'long',
      'short',
    ];
    const questionLower = question.toLowerCase();
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

  private extractCryptoSymbols(question: string): string[] {
    const words = question.toLowerCase().split(/\s+/);
    const foundCoins = new Set<string>();

    // Check for specific coins first
    for (const word of words) {
      const coinId = this.coinListService.findCoinId(word);
      if (coinId) {
        foundCoins.add(coinId);
      }
    }

    // If asking about funding rates in general and no specific coins mentioned,
    // return top traded coins
    if (foundCoins.size === 0 && this.checkIfNeedsFunding(question)) {
      return ['btc', 'eth']; // Default to major cryptocurrencies
    }

    return Array.from(foundCoins);
  }

  private formatResponse(data: CryptoData[]): string {
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
      .slice(0, 5)
      .map((coin) => `${coin.symbol.toUpperCase()}`)
      .join(', ');
    return `Available cryptocurrencies: ${availableCoins}, and more. Please specify one.`;
  }

  private async generateResponse(
    question: string,
    symbols: string[],
    data: CryptoData[],
  ): Promise<string> {
    const context = this.formatResponse(data);
    const symbolList = symbols.join(', ').toUpperCase();

    const formattedPrompt = await this.promptTemplate.format({
      symbols: symbolList,
      context,
      question,
    });

    const response = await this.llm.invoke(formattedPrompt);
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(response.content);
  }
}
