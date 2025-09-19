import { GSwapAPI } from './api/gswap';
import { ArbitrageDetector } from './strategies/arbitrage';
import { TradeExecutor } from './trader/executor';
import { KafkaBlockConsumer, RealTimeEventProcessor, createKafkaConfig } from './streaming';
import { config, validateConfig } from './config';

class GalaStreamingBot {
  private api: GSwapAPI;
  private detector: ArbitrageDetector;
  private executor: TradeExecutor;
  private kafkaConsumer: KafkaBlockConsumer;
  private eventProcessor: RealTimeEventProcessor;
  private isRunning: boolean = false;

  constructor() {
    this.api = new GSwapAPI();
    this.detector = new ArbitrageDetector();
    this.executor = new TradeExecutor(this.api);
    this.eventProcessor = new RealTimeEventProcessor(this.api);
    
    // Create Kafka consumer with configuration
    const kafkaConfig = createKafkaConfig();
    this.kafkaConsumer = new KafkaBlockConsumer(kafkaConfig, this.eventProcessor);
  }

  async start(): Promise<void> {
    try {
      // Validate configuration
      validateConfig();

      // Load available tokens at startup
      await this.api.loadAvailableTokens();

      // Test API connection
      await this.testApiConnection();

      // Start Kafka consumer
      await this.kafkaConsumer.start();

      this.isRunning = true;
      console.log('🚀 Gala Streaming Bot started - Monitoring for arbitrage opportunities...');

    } catch (error) {
      console.error('❌ Failed to start streaming bot:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Stop Kafka consumer
    await this.kafkaConsumer.stop();

    // Generate mock trading report if in mock mode
    this.eventProcessor.generateMockReport();

    // Cancel all active trades
    const activeTrades = this.executor.getActiveTrades();
    for (const trade of activeTrades) {
      if (trade.status === 'pending' || trade.status === 'buying' || trade.status === 'selling') {
        await this.executor.cancelTradeExecution(trade.id);
      }
    }
  }

  private async testApiConnection(): Promise<void> {
    try {
      const connected = await this.api.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to gSwap');
      }
      
      const tokens = await this.api.getAvailableTokens();
      console.log(`📈 Found ${tokens.length} available tokens`);
      
    } catch (error) {
      throw new Error(`gSwap connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get bot status and statistics
   */
  getStatus(): {
    isRunning: boolean;
    kafkaStatus: { isRunning: boolean; connected: boolean };
    processingStats: {
      blocksProcessed: number;
      blocksFiltered: number;
      opportunitiesFound: number;
      tradesExecuted: number;
      mockStats?: {
        totalTransactions: number;
        arbitrageTrades: number;
        swapTrades: number;
        totalProfit: number;
        successRate: number;
      };
    };
    tradingStats: {
      totalTrades: number;
      completedTrades: number;
      failedTrades: number;
      totalProfit: number;
      averageProfit: number;
      successRate: number;
    };
  } {
    return {
      isRunning: this.isRunning,
      kafkaStatus: this.kafkaConsumer.getStatus(),
      processingStats: this.eventProcessor.getStats(),
      tradingStats: this.executor.getTradingStats(),
    };
  }

  /**
   * Log current status
   */
  logStatus(): void {
    const status = this.getStatus();
    
    if (status.processingStats.opportunitiesFound > 0 || status.tradingStats.totalTrades > 0) {
      console.log('\n📊 Arbitrage Status:');
      console.log(`   Opportunities Found: ${status.processingStats.opportunitiesFound}`);
      console.log(`   Trades Executed: ${status.tradingStats.totalTrades}`);
      console.log(`   Success Rate: ${status.tradingStats.successRate.toFixed(1)}%`);
      console.log(`   Total Profit: ${status.tradingStats.totalProfit.toFixed(2)}`);
      
      // Show mock trading stats if in mock mode
      if (status.processingStats.mockStats) {
        console.log('\n🎭 Mock Trading Stats:');
        console.log(`   Total Transactions: ${status.processingStats.mockStats.totalTransactions}`);
        console.log(`   Arbitrage Trades: ${status.processingStats.mockStats.arbitrageTrades}`);
        console.log(`   Swap Trades: ${status.processingStats.mockStats.swapTrades}`);
        console.log(`   Total Profit: ${status.processingStats.mockStats.totalProfit.toFixed(6)}`);
        console.log(`   Success Rate: ${status.processingStats.mockStats.successRate.toFixed(2)}%`);
      }
    }
  }
}

// Main execution
async function main() {
  const bot = new GalaStreamingBot();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);
    await bot.stop();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    await bot.stop();
    process.exit(1);
  });

  // Start the bot
  await bot.start();

  // Log status every 30 seconds
  setInterval(() => {
    bot.logStatus();
  }, 30000);
}

// Run the bot
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { GalaStreamingBot };
