import { GSwapAPI } from '../api/gswap';
import { ArbitrageDetector } from '../strategies/arbitrage';
import { TradeExecutor } from '../trader/executor';
import { config, validateConfig } from '../config';
import { ensureMongoConnection } from '../db/mongoClient';
import { KafkaBlockConsumer } from './kafkaConsumer';
import { RealTimeEventProcessor } from './eventProcessor';
import { KafkaConfig } from './types';

export function createKafkaConfig(): KafkaConfig {
  return {
    apiUrl: process.env.KAFKA_API_URL || '',
    apiKey: process.env.KAFKA_API_KEY || '',
    apiSecret: process.env.KAFKA_API_SECRET || '',
    topic: process.env.KAFKA_TOPIC || '',
    clientId: 'gala-trading-bot',
    groupId: 'gala-trading-group',
  };
}

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

    const kafkaConfig = createKafkaConfig();
    this.kafkaConsumer = new KafkaBlockConsumer(kafkaConfig, this.eventProcessor);
  }

  async start(): Promise<void> {
    try {
      validateConfig();

      await ensureMongoConnection();

      await this.api.loadAvailableTokens();
      await this.testApiConnection();

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

    await this.kafkaConsumer.stop();

    const activeTrades = this.executor.getActiveTrades();
    for (const trade of activeTrades) {
      if (trade.status === 'pending' || trade.status === 'buying' || trade.status === 'selling') {
        await this.executor.cancelTradeExecution(trade.id);
      }
    }
  }

  logStatus(): void {
    const status = this.getStatus();

    if (status.processingStats.opportunitiesFound > 0 || status.tradingStats.totalTrades > 0) {
      console.log('\n📊 Arbitrage Status:');
      console.log(`   Opportunities Found: ${status.processingStats.opportunitiesFound}`);
      console.log(`   Trades Executed: ${status.tradingStats.totalTrades}`);
      console.log(`   Success Rate: ${status.tradingStats.successRate.toFixed(1)}%`);
      console.log(`   Total Profit: ${status.tradingStats.totalProfit.toFixed(2)}`);
    }
  }

  getStatus(): {
    isRunning: boolean;
    kafkaStatus: { isRunning: boolean; connected: boolean };
    processingStats: {
      blocksProcessed: number;
      blocksFiltered: number;
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
}

export { GalaStreamingBot, KafkaBlockConsumer, RealTimeEventProcessor };
export * from './types';
