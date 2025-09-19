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
    this.eventProcessor = new RealTimeEventProcessor(this.api, this.detector, this.executor);
    
    // Create Kafka consumer with configuration
    const kafkaConfig = createKafkaConfig();
    this.kafkaConsumer = new KafkaBlockConsumer(kafkaConfig, this.eventProcessor);
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Gala Streaming Bot...');
      
      // Validate configuration
      validateConfig();
      console.log('✅ Configuration validated');

      // Test API connection
      await this.testApiConnection();
      console.log('✅ API connection established');

      // Start Kafka consumer
      await this.kafkaConsumer.start();
      console.log('✅ Kafka consumer started');

      this.isRunning = true;
      console.log('✅ Streaming bot started successfully');
      console.log('📡 Listening for real-time block data...');

    } catch (error) {
      console.error('❌ Failed to start streaming bot:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Gala Streaming Bot...');
    
    this.isRunning = false;
    
    // Stop Kafka consumer
    await this.kafkaConsumer.stop();

    // Cancel all active trades
    const activeTrades = this.executor.getActiveTrades();
    for (const trade of activeTrades) {
      if (trade.status === 'pending' || trade.status === 'buying' || trade.status === 'selling') {
        await this.executor.cancelTradeExecution(trade.id);
      }
    }

    console.log('✅ Streaming bot stopped');
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
      swapsProcessed: number;
      opportunitiesFound: number;
      tradesExecuted: number;
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
    
    console.log('\n📊 Streaming Bot Status:');
    console.log(`   Running: ${status.isRunning}`);
    console.log(`   Kafka Connected: ${status.kafkaStatus.connected}`);
    console.log(`   Blocks Processed: ${status.processingStats.blocksProcessed}`);
    console.log(`   Swaps Processed: ${status.processingStats.swapsProcessed}`);
    console.log(`   Opportunities Found: ${status.processingStats.opportunitiesFound}`);
    console.log(`   Trades Executed: ${status.tradingStats.totalTrades}`);
    console.log(`   Success Rate: ${status.tradingStats.successRate.toFixed(1)}%`);
    console.log(`   Total Profit: ${status.tradingStats.totalProfit.toFixed(2)}`);
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
