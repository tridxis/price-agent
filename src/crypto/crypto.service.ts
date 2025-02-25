import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { PriceDataService } from './price-data.service';
import { CoinListService } from './coin-list.service';
import { CryptoPrice } from './price-data.service';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly llm: ChatOpenAI;
  private readonly promptTemplate: PromptTemplate;

  constructor(
    private readonly priceDataService: PriceDataService,
    private readonly coinListService: CoinListService,
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-4o-mini',
      temperature: 0.7,
    });

    this.promptTemplate = PromptTemplate.fromTemplate(`
      You are a helpful cryptocurrency expert. Use the following price data to answer the user's question.
      Available cryptocurrencies: {symbols}
      
      Current prices from multiple exchanges:
      {context}
      
      Question: {question}
      
      Please provide a clear and concise answer based on the available data. Always mention price differences between exchanges if they exist.
      For significant price differences (>1%), suggest possible reasons for the disparity.
    `);
  }

  async processQuestion(question: string): Promise<string> {
    try {
      const symbols = this.extractCryptoSymbols(question);

      if (symbols.length === 0) {
        const availableCoins = this.coinListService
          .getSupportedCoins()
          .slice(0, 5)
          .map((coin) => `${coin.symbol.toUpperCase()}/${coin.name}`)
          .join(', ');
        return `I could not identify any supported cryptocurrencies in your question. You can ask about cryptocurrencies like: ${availableCoins}, and many more.`;
      }

      const priceData = await Promise.all(
        symbols.map((symbol) => this.priceDataService.getPriceData(symbol)),
      );

      const context = this.formatPriceResponse(priceData);

      const allSymbols = this.coinListService
        .getSupportedCoins()
        .slice(0, 10)
        .map((coin) => `${coin.symbol.toUpperCase()}/${coin.name}`)
        .join(', ');

      const formattedPrompt = await this.promptTemplate.format({
        symbols: allSymbols,
        context,
        question,
      });

      const response = await this.llm.invoke(formattedPrompt);
      if (typeof response.content === 'object') {
        return JSON.stringify(response.content);
      }
      return String(response.content);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to process question: ${err.message}`);
      return 'Sorry, I encountered an error while fetching cryptocurrency prices.';
    }
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
