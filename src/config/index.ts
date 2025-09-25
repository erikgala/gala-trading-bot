import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface BotConfig {
  // Wallet Configuration
  privateKey: string;
  walletAddress: string;

  // Trading Configuration
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
  
  minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.5'), // 0.5%
  maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT || '1000'),
  pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000'), // 5 seconds
  slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '5.0'), // 5%
  balanceRefreshInterval: parseInt(process.env.BALANCE_REFRESH_INTERVAL || '0'), // 0 = disabled
  arbitrageStrategy: (process.env.ARBITRAGE_STRATEGY as StrategySelection) || 'direct',
  
  maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '3'),
  stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '5.0'), // 5%
  
  galaSwapApiUrl: process.env.GALASWAP_API_URL || 'https://dex-backend-prod1.defi.gala.com',
  
  // Mock Trading Configuration
  mockMode: process.env.MOCK_MODE === 'true',
  mockRunName: process.env.MOCK_RUN_NAME?.replace('${timestamp}', Date.now().toString()) || `run_${Date.now()}`,
  mockWalletBalances: JSON.parse(process.env.MOCK_WALLET_BALANCES || '{"GALA|Unit|none|none": 10000, "GUSDC|Unit|none|none": 5000, "GUSDT|Unit|none|none": 5000, "GWETH|Unit|none|none": 10, "GWBTC|Unit|none|none": 1}'),
  
  logLevel: (process.env.LOG_LEVEL as BotConfig['logLevel']) || 'info',

  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: process.env.MONGO_DB_NAME || '',
  mongoTradesCollection: process.env.MONGO_TRADES_COLLECTION || 'tradeExecutions',
};

// Validate required configuration
export function validateConfig(): void {
  if (!config.privateKey) {
    throw new Error('PRIVATE_KEY is required');
  }
  
  if (!config.walletAddress) {
    throw new Error('WALLET_ADDRESS is required');
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

  if (!config.mongoUri || !config.mongoDbName) {
    console.warn('ℹ️  MongoDB logging disabled. Set MONGO_URI and MONGO_DB_NAME to enable trade tracking.');
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
