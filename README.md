# Price Agent

A NestJS application for cryptocurrency market analysis and trading signals.

## Overview

Price Agent is a sophisticated platform that provides real-time cryptocurrency market data, technical analysis, and automated trading signals. It integrates with multiple exchanges to gather price data, funding rates, and historical information to generate actionable insights.

## Features

- **Real-time Market Data**: Collects and aggregates price data from Binance, Bybit, OKX, and Hyperliquid
- **Technical Analysis**: Implements various indicators including RSI, MACD, Bollinger Bands, and Ichimoku Cloud
- **Trading Signals**: Generates trading opportunities based on multiple timeframes and strategies
- **Trader Analysis**: Analyzes professional traders' activities and performance
- **Leaderboard Tracking**: Monitors top performers on Hyperliquid

## Trading Strategies

The system supports multiple trading styles:

- **Scalping**: Ultra-short term trades using 3m candles with 15m confirmation
- **Day Trading**: Intraday trades using 15m and 1h timeframes
- **Swing Trading**: Multi-day positions using 1h and 4h timeframes
- **Position Trading**: Longer-term positions using 4h timeframes

## Technical Stack

- **Backend**: NestJS with TypeScript
- **Data Processing**: Custom technical analysis utilities
- **API Integration**: Multiple exchange APIs
- **Scheduling**: Cron jobs for regular data updates and signal generation

## Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn
- API keys for supported exchanges (optional)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/tridxis/price-agent.git
cd price-agent
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with your API keys:

```
OPENAI_API_KEY=your_openai_key
HUGGINGFACE_API_KEY=your_huggingface_key
COINMARKETCAP_API_KEY=your_coinmarketcap_key
```

4. Start the application:

```bash
npm run start:dev
```

## Usage

### Trading Monitor

The trading monitor automatically scans for trading opportunities based on configured strategies:

```typescript
// Run a specific trading style
tradingMonitorJob.monitorTradingOpportunities('Scalping');

// Run all trading styles
tradingMonitorJob.monitorTradingOpportunities();
```

### Trader Analysis

Analyze professional traders' activities:

```
GET /trader/:address
```

## License

[MIT License](LICENSE)
