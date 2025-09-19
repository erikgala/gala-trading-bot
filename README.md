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

## Quick Start

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd gala-trading-bot
   npm install
   ```

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
   npm run streaming
   ```
   
   **Mock Mode (Safe testing):**
   ```bash
   MOCK_MODE=true npm start
   # or
   MOCK_MODE=true npm run streaming
   ```

## Operation Modes

### Polling Mode (`npm start`)
- **Best for**: Beginners, testing, and stable trading
- **How it works**: Periodically checks for arbitrage opportunities (every 5 seconds by default)
- **Pros**: Simple, predictable, easier to debug
- **Cons**: Slower response to market changes

### Streaming Mode (`npm run streaming`)
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
| `MIN_PROFIT_THRESHOLD` | Minimum profit % to execute trades | `0.5` |
| `MAX_TRADE_AMOUNT` | Maximum amount per trade | `1000` |
| `POLLING_INTERVAL` | Market data polling interval (ms) | `5000` |
| `SLIPPAGE_TOLERANCE` | Slippage tolerance percentage | `5.0` |
| `MAX_CONCURRENT_TRADES` | Maximum concurrent trades | `3` |
| `STOP_LOSS_PERCENTAGE` | Stop-loss percentage | `5.0` |
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
│   ├── mockWallet.ts      # Mock wallet with balances
│   ├── mockTradeExecutor.ts # Mock trade execution
│   └── csvLogger.ts       # CSV transaction logging
├── streaming/        # Real-time streaming mode
│   ├── kafkaConsumer.ts   # Kafka message consumer
│   ├── eventProcessor.ts  # Block event processing
│   └── types.ts          # Streaming data types
├── index.ts          # Polling mode entry point
└── streamingBot.ts   # Streaming mode entry point
```

## Trading Strategies

### Cross-Pair Arbitrage
Detects price differences between different trading pairs for the same token.

### Direct Arbitrage
Identifies profitable bid-ask spreads within the same trading pair.

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
node dist/streamingBot.js

# Test mock mode
MOCK_MODE=true npm run dev
```

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