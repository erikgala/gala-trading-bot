import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export type BotMode = 'polling' | 'streaming';

export interface BotConfig {
  // Wallet Configuration
  privateKey: string;
  walletAddress: string;

  // Trading Configuration
  mode: BotMode;
  minProfitThreshold: number; // Minimum profit percentage to execute trades
  maxTradeAmount: number; // Maximum amount to trade per opportunity
  pollingInterval: number; // Polling interval in milliseconds
  slippageTolerance: number; // Slippage tolerance percentage (e.g., 5 for 5%)
  balanceRefreshInterval: number; // How often to refresh cached wallet balances
  arbitrageStrategy: StrategySelection;
  
  // Risk Management
  maxConcurrentTrades: number;
  stopLossPercentage: number;
  
  // GalaSwap API Configuration
  galaSwapApiUrl: string;
  
  // Mock Trading Configuration
  mockMode: boolean;
  mockRunName: string;
  mockWalletBalances: Record<string, number>;
  
  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // MongoDB Logging
  mongoUri: string;
  mongoDbName: string;
  mongoTradesCollection: string;
}

export type StrategySelection = 'direct' | 'triangular' | 'both';

export const config: BotConfig = {
  privateKey: process.env.PRIVATE_KEY || '',
  walletAddress: process.env.WALLET_ADDRESS || '',
  mode: (process.env.BOT_MODE as BotMode) || 'polling',
  galaSwapApiUrl: process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com',
  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: process.env.MONGO_DB_NAME || 'trading-bot',
  mongoTradesCollection: process.env.MONGO_TRADES_COLLECTION || 'tradeExecutions',

  // Mock Trading Configuration
  mockMode: process.env.MOCK_MODE === 'true',
  mockRunName: process.env.MOCK_RUN_NAME?.replace('${timestamp}', Date.now().toString()) || `run_${Date.now()}`,
  mockWalletBalances: JSON.parse(process.env.MOCK_WALLET_BALANCES || '{"GALA|Unit|none|none": 10000, "GUSDC|Unit|none|none": 5000, "GUSDT|Unit|none|none": 5000, "GWETH|Unit|none|none": 10, "GWBTC|Unit|none|none": 1}'),
  
  logLevel: (process.env.LOG_LEVEL as BotConfig['logLevel']) || 'info',

  // Constants
  minProfitThreshold: 0.5, // 0.5%
  maxTradeAmount: 3000,
  pollingInterval: 5000, // 5 seconds
  slippageTolerance: 5.0, // 5%
  balanceRefreshInterval: 0, // 0 = disabled
  arbitrageStrategy: 'direct',
  maxConcurrentTrades: 3,
  stopLossPercentage: 5.0, // 5%
};

// Validate required configuration
export function validateConfig(): void {
  const validModes: BotMode[] = ['polling', 'streaming'];
  if (!validModes.includes(config.mode)) {
    throw new Error('BOT_MODE must be one of polling or streaming');
  }

  const requiredEnvVars: Array<{ name: string; value: string | undefined }> = [
    { name: 'PRIVATE_KEY', value: config.privateKey || undefined },
    { name: 'WALLET_ADDRESS', value: config.walletAddress || undefined },
    { name: 'MONGO_URI', value: config.mongoUri || undefined },
  ];

  if (config.mode === 'streaming') {
    requiredEnvVars.push(
      { name: 'KAFKA_API_URL', value: process.env.KAFKA_API_URL },
      { name: 'KAFKA_API_KEY', value: process.env.KAFKA_API_KEY },
      { name: 'KAFKA_API_SECRET', value: process.env.KAFKA_API_SECRET },
      { name: 'KAFKA_TOPIC', value: process.env.KAFKA_TOPIC },
    );
  }

  const missingEnvVars = requiredEnvVars
    .filter(({ value }) => !value)
    .map(({ name }) => name);

  if (missingEnvVars.length > 0) {
    const suffix = missingEnvVars.length > 1 ? 's' : '';
    throw new Error(`Missing required environment variable${suffix}: ${missingEnvVars.join(', ')}`);
  }

  if (config.minProfitThreshold <= 0) {
    throw new Error('MIN_PROFIT_THRESHOLD must be greater than 0');
  }
  
  if (config.maxTradeAmount <= 0) {
    throw new Error('MAX_TRADE_AMOUNT must be greater than 0');
  }
  
  if (config.pollingInterval < 1000) {
    throw new Error('POLLING_INTERVAL must be at least 1000ms');
  }
  
  if (config.slippageTolerance <= 0 || config.slippageTolerance > 100) {
    throw new Error('SLIPPAGE_TOLERANCE must be between 0 and 100');
  }

  if (config.balanceRefreshInterval < 0) {
    throw new Error('BALANCE_REFRESH_INTERVAL must be 0 or greater');
  }

  const validStrategies: StrategySelection[] = ['direct', 'triangular', 'both'];
  if (!validStrategies.includes(config.arbitrageStrategy)) {
    throw new Error('ARBITRAGE_STRATEGY must be one of direct, triangular, or both');
  }
}

export function getEnabledStrategyModes(): Array<'direct' | 'triangular'> {
  switch (config.arbitrageStrategy) {
    case 'direct':
      return ['direct'];
    case 'triangular':
      return ['triangular'];
    case 'both':
    default:
      return ['direct', 'triangular'];
  }
}
