# Gala Trading Bot

A sophisticated arbitrage trading bot for the GalaChain gSwap DEX built with Node.js and TypeScript using the official gSwap SDK.

## Features

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
   ```bash
   npm start
   ```

## Configuration

Create a `.env` file based on `env.example`:

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

## Project Structure

```
src/
├── config/           # Configuration management
├── api/              # gSwap SDK integration
├── strategies/       # Arbitrage detection strategies
├── trader/           # Trade execution engine
└── index.ts          # Main entry point
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

## Monitoring

The bot provides real-time statistics including:
- Total trades executed
- Success/failure rates
- Profit/loss tracking
- Active trade status

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build for production
npm run build

# Run built version
node dist/index.js
```

## Safety Notes

⚠️ **Important**: This bot is for educational purposes. Always:
- Test with small amounts first
- Monitor your trades closely
- Understand the risks involved
- Keep your private keys secure
- Use appropriate slippage and risk settings
- Ensure you have sufficient token balances

## License

ISC