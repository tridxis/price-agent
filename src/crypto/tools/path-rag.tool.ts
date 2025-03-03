import { Injectable } from '@nestjs/common';

interface PathNode<T> {
  value: T | null;
  children: Map<string, PathNode<T>>;
}

interface HistoricalData<T> {
  data: T;
  timestamp: number;
  metadata?: {
    trend?: 'up' | 'down' | 'stable';
    volatility?: number;
    volume?: number;
  };
}

interface PriceData {
  averagePrice: number;
  volume?: number;
}

@Injectable()
export class PathRAGTool<T> {
  private root: PathNode<T> = { value: null, children: new Map() };
  private readonly maxHistorySize = 1000; // Keep last 1000 data points
  private readonly data: Map<string, HistoricalData<T>[]> = new Map();

  insert(path: string[], value: T): void {
    const key = this.getKey(path);
    const historicalData = this.data.get(key) || [];

    historicalData.push({
      data: value,
      timestamp: Date.now(),
      metadata: this.generateMetadata(value, historicalData),
    });

    // Keep only latest maxHistorySize entries
    if (historicalData.length > this.maxHistorySize) {
      historicalData.shift();
    }

    this.data.set(key, historicalData);
  }

  search(path: string[], query?: { timeRange?: number; trend?: string }): T[] {
    const key = this.getKey(path);
    const historicalData = this.data.get(key) || [];

    if (!query) {
      return [historicalData[historicalData.length - 1]?.data].filter(Boolean);
    }

    return historicalData
      .filter((entry) => this.matchesQuery(entry, query))
      .map((entry) => entry.data);
  }

  private getKey(path: string[]): string {
    return path.join('.');
  }

  private generateMetadata(
    value: T,
    history: HistoricalData<T>[],
  ): HistoricalData<T>['metadata'] {
    if (!history.length) return {};

    // For price data, calculate trend and volatility
    if (this.isPriceData(value)) {
      const prices = history.map((h) =>
        this.isPriceData(h.data) ? h.data.averagePrice : 0,
      );
      const trend = this.calculateTrend(prices);
      const volatility = this.calculateVolatility(prices);

      return {
        trend,
        volatility,
        volume: value.volume || 0,
      };
    }

    return {};
  }

  private isPriceData(value: unknown): value is PriceData {
    return (
      typeof value === 'object' &&
      value !== null &&
      'averagePrice' in value &&
      typeof (value as PriceData).averagePrice === 'number'
    );
  }

  private calculateTrend(prices: number[]): 'up' | 'down' | 'stable' {
    if (prices.length < 2) return 'stable';

    const last = prices[prices.length - 1];
    const prev = prices[prices.length - 2];
    const changePct = ((last - prev) / prev) * 100;

    if (changePct > 1) return 'up';
    if (changePct < -1) return 'down';
    return 'stable';
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = prices
      .slice(1)
      .map((price, i) => Math.log(price / prices[i]));

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;

    return Math.sqrt(variance) * 100; // Annualized volatility
  }

  private matchesQuery(
    entry: HistoricalData<T>,
    query: { timeRange?: number; trend?: string },
  ): boolean {
    if (query.timeRange && Date.now() - entry.timestamp > query.timeRange) {
      return false;
    }
    if (query.trend && entry.metadata?.trend !== query.trend) {
      return false;
    }
    return true;
  }

  findSimilar(path: string[], maxDistance: number = 2): T[] {
    const results: T[] = [];
    this.findSimilarRecursive(this.root, path, 0, 0, maxDistance, results);
    return results;
  }

  private findSimilarRecursive(
    node: PathNode<T>,
    path: string[],
    depth: number,
    distance: number,
    maxDistance: number,
    results: T[],
  ): void {
    if (distance > maxDistance) return;
    if (depth === path.length) {
      if (node.value) results.push(node.value);
      return;
    }

    const segment = path[depth].toLowerCase();
    for (const [key, child] of node.children) {
      const newDistance = this.levenshteinDistance(segment, key);
      this.findSimilarRecursive(
        child,
        path,
        depth + 1,
        distance + newDistance,
        maxDistance,
        results,
      );
    }
  }

  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array(b.length + 1)
      .fill(null)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      .map(() => Array(a.length + 1).fill(0)) as number[][];

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i - 1] + cost,
        );
      }
    }

    return matrix[b.length][a.length];
  }
}
