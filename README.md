# Crypto Price Agent

A NestJS-based service that provides real-time cryptocurrency price information, technical analysis, and price predictions using natural language processing.

## Features

- Real-time cryptocurrency price data from multiple exchanges
- Natural language processing for crypto queries
- Technical analysis indicators (RSI, Moving Averages, Support/Resistance)
- Price predictions using historical data
- Funding rate information for perpetual contracts
- Caching system for optimal performance
- Rate-limited API requests
- Docker support with BERT service integration

## Prerequisites

- Node.js (v18 or higher)
- pnpm
- Docker and Docker Compose (for BERT service)
- Python 3.9+ (for BERT service development)

## Environment Variables

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
BERT_API_URL=http://localhost:8000
HUGGINGFACE_API_KEY=your_huggingface_api_key
```

## Installation

```bash
# Install dependencies
pnpm install

# Start the BERT service and API
docker-compose up -d

# Start the development server
pnpm run start:dev
```

## API Usage

### Query Endpoint

```http
POST /crypto/query
Content-Type: application/json

{
  "question": "What is the ETH price?"
}
```

Example questions:

- "What is the BTC price?"
- "Show me ETH funding rate"
- "What's the trend for BTC?"
- "Predict ETH price next day"
- "What's the RSI for BTC?"

## Project Structure

```
src/
├── shared/           # Shared services and tools
│   ├── services/     # Common services (cache, historical data, etc.)
│   ├── tools/        # Utility tools (price, funding, RAG)
│   └── types/        # Shared type definitions
├── crypto/           # Crypto module
│   ├── tools/        # Crypto-specific tools (NLP, analysis)
│   └── services/     # Crypto-specific services
└── bert-service/     # Python BERT service for NLP
```

## Development

```bash
# Run tests
pnpm run test

# Run e2e tests
pnpm run test:e2e

# Run linter
pnpm run lint

# Build for production
pnpm run build
```

## Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
