# Gala Trading Bot

A sophisticated arbitrage trading bot for the GalaChain gSwap DEX built with Node.js and TypeScript using the official gSwap SDK.

## Features

- **Dual Operation Modes**: Polling-based and real-time streaming modes
- **Mock Trading Support**: Safe testing environment with configurable balances and CSV logging
- **Direct Blockchain Integration**: Uses the official gSwap SDK for direct interaction with GalaChain
- **Real-time Market Data**: Fetches live token prices and trading pairs from gSwap
- **Arbitrage Detection**: Implements multiple arbitrage strategies including cross-pair and direct arbitrage
- **Automated Trading**: Executes swaps automatically when profitable opportunities are detected
- **Risk Management**: Configurable limits for trade amounts, concurrent trades, and slippage tolerance
- **Robust Error Handling**: Comprehensive error handling and retry mechanisms
- **Real-time Monitoring**: Live statistics and trade monitoring
- **TypeScript**: Full type safety and modern JavaScript features

## Project Suite

This repository now contains a small suite of projects that work together:

- **Trading Bot (`/src`)** – the original arbitrage bot capable of running standalone or in Docker.
- **Monitoring API (`projects/api-server`)** – Node.js service that streams MongoDB trade data over WebSockets and exposes REST endpoints for dashboards.
- **Monitoring Client (`projects/client`)** – Vite + React dashboard that consumes the API and visualises live profit/loss.

Each project has its own `package.json`. Install dependencies as needed, for example:

```bash
npm install                              # bot
npm install --prefix projects/api-server # monitoring API
npm install --prefix projects/client     # monitoring client
```

## Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd gala-trading-bot
   npm install
   ```
   > The installation step sets up a Husky-powered Git pre-commit hook that runs `npm run build` and `npm test` before every commit. Re-run `npm run prepare` if you ever need to reinstall the hook manually.

2. **Configure Environment**
   ```bash
   cp env.example .env
   # Edit .env with your API keys and trading parameters
   ```

3. **Run the Bot**
   
   **Polling Mode (Recommended for beginners):**
   ```bash
   npm start
   ```
   
   **Real-time Streaming Mode (Advanced):**
   ```bash
   BOT_MODE=streaming npm start
   # or (TypeScript runtime)
   npm run streaming
   ```
   
   **Mock Mode (Safe testing):**
   ```bash
   MOCK_MODE=true npm start
   # or
   MOCK_MODE=true npm run streaming
   ```

4. **(Optional) Run the Monitoring Stack Locally**

   With MongoDB enabled for the bot, you can stream trades into a dashboard:

   ```bash
   # Terminal 1 – monitoring API
   npm run dev --prefix projects/api-server

   # Terminal 2 – monitoring client
   npm run dev --prefix projects/client
   ```

   By default the API listens on `http://localhost:4400` and the client on `http://localhost:5173`.

## Docker

Build the production image locally:

```bash
docker build -t trading-bot .
```

Run the container locally:

```bash
docker run --rm -it \
  -e BOT_WALLET_KEY=xxx \
  -e KAFKA_USERNAME=xxx \
  -e KAFKA_PASSWORD=xxx \
  -e BOT_MODE=polling \
  trading-bot
```

Set `BOT_MODE=streaming` in the command above to switch the container to streaming mode.

## Deployment

Pushes to `main` trigger GitHub Actions to build the Docker image, push it to Docker Hub, and redeploy the DigitalOcean droplet with the freshly pulled container.

## Security

- Never commit `.env` or other secret material to the repository.
- Secrets are injected at runtime through environment variables provided to the container and workflow, so the image remains free of sensitive data.

## Operation Modes

### Polling Mode (`npm start`)
- **Best for**: Beginners, testing, and stable trading
- **How it works**: Periodically checks for arbitrage opportunities (every 5 seconds by default)
- **Pros**: Simple, predictable, easier to debug
- **Cons**: Slower response to market changes

### Streaming Mode (`BOT_MODE=streaming`)
- **Best for**: Advanced users, high-frequency trading
- **How it works**: Real-time analysis of blockchain events via Kafka
- **Pros**: Instant response to market changes, more opportunities
- **Cons**: More complex setup, requires Kafka configuration

### Mock Mode
- **Best for**: Testing strategies safely
- **How it works**: Simulates trades without real money
- **Features**: 
  - Configurable starting balances
  - CSV transaction logging
  - Profit/loss tracking
  - Detailed reports

## Configuration

Create a `.env` file based on `env.example`:

### Core Trading Settings
| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Your wallet private key | Required |
| `WALLET_ADDRESS` | Your wallet address | Required |
| `BOT_MODE` | Execution mode (`polling` or `streaming`) | `polling` |
| `MIN_PROFIT_THRESHOLD` | Minimum profit % to execute trades | `0.5` |
| `MAX_TRADE_AMOUNT` | Maximum amount per trade | `1000` |
| `POLLING_INTERVAL` | Market data polling interval (ms) | `5000` |
| `SLIPPAGE_TOLERANCE` | Slippage tolerance percentage | `5.0` |
| `MAX_CONCURRENT_TRADES` | Maximum concurrent trades | `3` |
| `STOP_LOSS_PERCENTAGE` | Stop-loss percentage | `5.0` |
| `ARBITRAGE_STRATEGY` | Active strategies (`direct`, `triangular`, `both`) | `direct` |
| `LOG_LEVEL` | Logging level | `info` |

### Mock Trading Settings
| Variable | Description | Default |
|----------|-------------|---------|
| `MOCK_MODE` | Enable mock trading mode | `false` |
| `MOCK_RUN_NAME` | Unique name for mock run | `run_${timestamp}` |
| `MOCK_WALLET_BALANCES` | Initial token balances (JSON) | See env.example |

### Streaming Mode Settings (Kafka)
| Variable | Description | Required for Streaming |
|----------|-------------|----------------------|
| `KAFKA_API_URL` | Kafka broker URL | Yes |
| `KAFKA_API_KEY` | Kafka API key | Yes |
| `KAFKA_API_SECRET` | Kafka API secret | Yes |
| `KAFKA_TOPIC` | Kafka topic to consume | Yes |
| `KAFKA_SCHEMA_HOST` | Schema registry host | Yes |
| `KAFKA_SCHEMA_USERNAME` | Schema registry username | Yes |
| `KAFKA_SCHEMA_PASSWORD` | Schema registry password | Yes |

## Project Structure

```
src/
├── config/           # Configuration management
├── api/              # gSwap SDK integration
├── strategies/       # Arbitrage detection strategies
├── trader/           # Trade execution engine
├── mock/             # Mock trading system
├── streaming/        # Real-time streaming mode
└── index.ts          # Main entry point (polling or streaming via BOT_MODE)

projects/
├── api-server/       # Monitoring API (Express + WebSocket)
│   └── src/
└── client/           # Monitoring dashboard (Vite + React)
    └── src/
```

## Trading Strategies

### Cross-Pair Arbitrage
Detects price differences between different trading pairs for the same token.

### Direct Arbitrage
Identifies profitable bid-ask spreads within the same trading pair.

### Triangular Arbitrage
Cycles through three tokens (e.g., `GALA -> Token X -> Token Y -> GALA`) to exploit pricing inefficiencies while caching quote data for efficiency.

## gSwap SDK Integration

The bot uses the official gSwap SDK: https://galachain.github.io/gswap-sdk/docs/intro/

### Key Features
- Direct blockchain interaction with GalaChain
- Real-time price quotes and swap execution
- Built-in slippage protection and fee management
- Support for multiple token types (GALA, GUSDC, GETH, GBTC)

## Risk Management

- **Position Limits**: Configurable maximum trade amounts
- **Concurrent Trade Limits**: Prevents over-trading
- **Slippage Protection**: Configurable slippage tolerance for swaps
- **Profit Thresholds**: Only execute trades above minimum profit

## Mock Trading

The bot includes a comprehensive mock trading system for safe testing:

### Features
- **Safe Testing**: No real money at risk
- **Configurable Balances**: Set starting token amounts
- **CSV Logging**: Detailed transaction logs in `mock_runs/` folder
- **Profit Tracking**: Monitor simulated profits and losses
- **Report Generation**: Automatic summary reports

### Mock Trading Files
- `mock_runs/run_1234567890.csv` - Detailed transaction log
- `mock_runs/run_1234567890_summary.txt` - Summary report

### Example Mock Configuration
```env
MOCK_MODE=true
MOCK_RUN_NAME=test_strategy_001
MOCK_WALLET_BALANCES={"GALA|Unit|none|none": 10000, "GUSDC|Unit|none|none": 5000, "GUSDT|Unit|none|none": 5000, "GWETH|Unit|none|none": 10, "GWBTC|Unit|none|none": 1}
```

## Monitoring

The bot provides real-time statistics including:
- Total trades executed
- Success/failure rates
- Profit/loss tracking
- Active trade status
- Mock trading statistics (when in mock mode)

When MongoDB logging is enabled you can also stream data into the dedicated monitoring stack:

- **Monitoring API** (`projects/api-server`)
  - REST endpoints: `/api/summary`, `/api/trades/recent`, `/api/trades/:executionId`
  - WebSocket feed: `ws://localhost:4400/ws/trades` (configurable via environment variables)
  - Broadcasts trade inserts/updates by tailing MongoDB change streams and falls back to HTTP polling if streams are unavailable.
- **Monitoring Client** (`projects/client`)
  - React dashboard that consumes the WebSocket feed and falls back to REST polling
  - Displays live profit/loss aggregates and the most recent executions
  - Configure via `VITE_MONITORING_*` variables or let it use sensible defaults

## Development

```bash
# Development mode with auto-reload (polling)
npm run dev

# Development mode with auto-reload (streaming)
npm run dev:streaming

# Build for production
npm run build

# Run built version (polling)
node dist/index.js

# Run built version (streaming)
BOT_MODE=streaming node dist/index.js

# Test mock mode
MOCK_MODE=true npm run dev
```

Automated tests skip connecting to a real MongoDB instance by default. Set `USE_REAL_MONGO_IN_TESTS=true` if you explicitly need to exercise the live database during test runs.

## Safety Notes

⚠️ **Important**: This bot is for educational purposes. Always:
- **Start with Mock Mode**: Test strategies safely before using real money
- Test with small amounts first
- Monitor your trades closely
- Understand the risks involved
- Keep your private keys secure
- Use appropriate slippage and risk settings
- Ensure you have sufficient token balances
- **Streaming Mode**: Requires proper Kafka setup and monitoring
- **Polling Mode**: Recommended for beginners

## License

ISC
