import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { PriceDataService } from './price-data.service';
import { CoinListService } from './coin-list.service';
import { CryptoPrice } from './price-data.service';
import { CacheService } from './cache.service';

interface AIResponse {
  response: string;
  timestamp: number;
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly llm: ChatOpenAI;
  private readonly promptTemplate: PromptTemplate;
  private readonly responseCache: Map<string, AIResponse> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds for AI responses

  constructor(
    private readonly priceDataService: PriceDataService,
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

    this.promptTemplate = PromptTemplate.fromTemplate(
      'Crypto expert analysis for {symbols}. Prices: {context}. Q: {question}. A:',
    );
  }

  async processQuestion(question: string): Promise<string> {
    try {
      const symbols = this.extractCryptoSymbols(question);

      if (symbols.length === 0) {
        const availableCoins = this.coinListService
          .getSupportedCoins()
          .slice(0, 5)
          .map((coin) => `${coin.symbol.toUpperCase()}`)
          .join(', ');
        return `Available cryptocurrencies: ${availableCoins}, and more. Please specify one.`;
      }

      // Generate cache key from question and symbols
      const cacheKey = `${question}_${symbols.sort().join('_')}`;
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached;

      const priceData = await Promise.all(
        symbols.map((symbol) => this.priceDataService.getPriceData(symbol)),
      );

      const context = this.formatPriceResponse(priceData);
      const symbolList = symbols.join(', ').toUpperCase();

      const formattedPrompt = await this.promptTemplate.format({
        symbols: symbolList,
        context,
        question,
      });

      const response = await this.llm.invoke(formattedPrompt);
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const result = String(response.content);

      // Cache the response
      this.cacheResponse(cacheKey, result);

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to process question: ${err.message}`);
      return 'Sorry, I encountered an error while fetching cryptocurrency prices.';
    }
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

    for (const word of words) {
      const coinId = this.coinListService.findCoinId(word);
      if (coinId) {
        foundCoins.add(coinId);
      }
    }

    return Array.from(foundCoins);
  }

  private formatPriceResponse(priceData: CryptoPrice[]): string {
    return priceData
      .map((data) => {
        const priceList = data.prices
          .map((p) => `${p.exchange}: $${p.price.toLocaleString()}`)
          .join('\n  ');

        return `${data.symbol}:\n  ${priceList}\n  Average: $${data.averagePrice.toLocaleString()}`;
      })
      .join('\n\n');
  }
}
