import { Injectable, Logger } from '@nestjs/common';
import { TimeframedPriceData } from '../shared/types/price.type';

@Injectable()
export class PricePredictionService {
  private readonly logger = new Logger(PricePredictionService.name);

  predictNextDay(historicalData: TimeframedPriceData[]): {
    prediction: number;
    confidence: number;
    trend: 'up' | 'down' | 'sideways';
  } {
    // console.log(historicalData.map((d) => d.prices));

    if (historicalData.length < 7) {
      throw new Error('Insufficient historical data for prediction');
    }

    // Calculate recent price changes
    const recentChanges = historicalData.slice(-7).map((d) => d.changes['24h']);
    const averageChange =
      recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;

    // Calculate volatility
    const volatility = Math.sqrt(
      recentChanges.reduce(
        (sum, change) => sum + Math.pow(change - averageChange, 2),
        0,
      ) / recentChanges.length,
    );

    // Get current price
    const currentPrice = historicalData[historicalData.length - 1].averagePrice;

    // Simple prediction based on momentum and volatility
    const predictedChange = averageChange * (1 - volatility / 100);
    const prediction = currentPrice * (1 + predictedChange / 100);

    // Calculate confidence based on volatility
    const confidence = Math.max(0, Math.min(100, 100 - volatility));

    // Determine trend
    const trend =
      predictedChange > 1 ? 'up' : predictedChange < -1 ? 'down' : 'sideways';

    return {
      prediction,
      confidence,
      trend,
    };
  }
}
