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
  
  // Risk Management
  maxConcurrentTrades: number;
  stopLossPercentage: number;
  
  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const config: BotConfig = {
  privateKey: process.env.PRIVATE_KEY || '',
  walletAddress: process.env.WALLET_ADDRESS || '',
  
  minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.5'), // 0.5%
  maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT || '1000'),
  pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000'), // 5 seconds
  slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '5.0'), // 5%
  
  maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '3'),
  stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '5.0'), // 5%
  
  logLevel: (process.env.LOG_LEVEL as BotConfig['logLevel']) || 'info',
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
}
