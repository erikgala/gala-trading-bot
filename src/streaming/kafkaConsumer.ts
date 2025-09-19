import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { BlockData, SwapEvent, TransactionData, KafkaConfig, EventProcessor } from './types';

export class KafkaBlockConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private eventProcessor: EventProcessor;
  private isRunning: boolean = false;
  private topic: string;

  constructor(config: KafkaConfig, eventProcessor: EventProcessor) {
    // Parse the API URL to extract brokers
    const brokers = this.parseBrokersFromUrl(config.apiUrl);
    
    this.kafka = new Kafka({
      clientId: config.clientId || 'gala-trading-bot',
      brokers: brokers,
      ssl: true, // Assume SSL for production Kafka
      sasl: {
        mechanism: 'plain',
        username: config.apiKey,
        password: config.apiSecret,
      },
    });

    this.consumer = this.kafka.consumer({ 
      groupId: config.groupId || 'gala-trading-group' 
    });
    this.eventProcessor = eventProcessor;
    this.topic = config.topic;
  }

  /**
   * Start consuming Kafka messages
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Kafka Block Consumer...');
      
      await this.consumer.connect();
      console.log('✅ Connected to Kafka');

      // Subscribe to the configured topic
      await this.consumer.subscribe({ 
        topic: this.topic,
        fromBeginning: false 
      });

      console.log('✅ Subscribed to topics');

      // Start consuming messages
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      this.isRunning = true;
      console.log('✅ Kafka consumer started successfully');

    } catch (error) {
      console.error('❌ Failed to start Kafka consumer:', error);
      throw error;
    }
  }

  /**
   * Stop consuming Kafka messages
   */
  async stop(): Promise<void> {
    try {
      console.log('🛑 Stopping Kafka Block Consumer...');
      
      this.isRunning = false;
      await this.consumer.disconnect();
      
      console.log('✅ Kafka consumer stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping Kafka consumer:', error);
    }
  }

  /**
   * Process incoming Kafka messages
   */
  private async processMessage(payload: EachMessagePayload): Promise<void> {
    try {
      const { topic, message } = payload;
      
      if (!message.value) {
        console.warn('⚠️  Received empty message');
        return;
      }

      const messageData = JSON.parse(message.value.toString());
      
      // Process all messages as block data for now
      // TODO: Update based on actual message structure
      await this.processBlockMessage(messageData);

    } catch (error) {
      console.error('❌ Error processing Kafka message:', error);
    }
  }

  /**
   * Process block data messages
   */
  private async processBlockMessage(data: any): Promise<void> {
    try {
      // TODO: Parse actual block data structure once we have the real schema
      const blockData: BlockData = {
        blockNumber: data.blockNumber || 0,
        blockHash: data.blockHash || '',
        timestamp: data.timestamp || Date.now(),
        transactions: data.transactions || [],
      };

      console.log(`📦 Processing block ${blockData.blockNumber} with ${blockData.transactions.length} transactions`);
      
      await this.eventProcessor.processBlock(blockData);

      // Process individual transactions for swap detection
      for (const tx of blockData.transactions) {
        await this.processTransactionMessage(tx);
      }

    } catch (error) {
      console.error('❌ Error processing block message:', error);
    }
  }

  /**
   * Process swap event messages
   */
  private async processSwapMessage(data: any): Promise<void> {
    try {
      // TODO: Parse actual swap data structure once we have the real schema
      const swapEvent: SwapEvent = {
        blockNumber: data.blockNumber || 0,
        transactionHash: data.transactionHash || '',
        timestamp: data.timestamp || Date.now(),
        dex: data.dex || 'unknown',
        tokenIn: data.tokenIn || '',
        tokenOut: data.tokenOut || '',
        amountIn: data.amountIn || '0',
        amountOut: data.amountOut || '0',
        priceImpact: data.priceImpact || 0,
        fee: data.fee || '0',
        user: data.user || '',
      };

      console.log(`🔄 Processing swap: ${swapEvent.tokenIn} -> ${swapEvent.tokenOut} (${swapEvent.amountIn})`);
      
      await this.eventProcessor.processSwap(swapEvent);

    } catch (error) {
      console.error('❌ Error processing swap message:', error);
    }
  }

  /**
   * Process transaction messages
   */
  private async processTransactionMessage(data: any): Promise<void> {
    try {
      // TODO: Parse actual transaction data structure once we have the real schema
      const txData: TransactionData = {
        hash: data.hash || '',
        from: data.from || '',
        to: data.to || '',
        value: data.value || '0',
        gasUsed: data.gasUsed || 0,
        gasPrice: data.gasPrice || '0',
        logs: data.logs || [],
      };

      // Only process if it looks like a swap transaction
      if (this.isSwapTransaction(txData)) {
        console.log(`🔍 Analyzing swap transaction: ${txData.hash}`);
        await this.eventProcessor.processTransaction(txData);
      }

    } catch (error) {
      console.error('❌ Error processing transaction message:', error);
    }
  }

  /**
   * Determine if a transaction is a swap
   */
  private isSwapTransaction(tx: TransactionData): boolean {
    // TODO: Implement proper swap detection based on real data structure
    // This is a placeholder that checks for common swap indicators
    
    // Check if transaction has logs (DEX interactions usually have events)
    if (tx.logs.length === 0) return false;
    
    // Check if transaction is to a known DEX contract
    const knownDexAddresses = [
      // Placeholder - will be updated with real DEX addresses
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ];
    
    return knownDexAddresses.some(addr => 
      tx.to?.toLowerCase() === addr.toLowerCase() ||
      tx.logs.some(log => log.address?.toLowerCase() === addr.toLowerCase())
    );
  }

  /**
   * Get consumer status
   */
  getStatus(): { isRunning: boolean; connected: boolean } {
    return {
      isRunning: this.isRunning,
      connected: this.consumer ? true : false, // Simplified check
    };
  }

  /**
   * Parse broker URLs from API URL
   */
  private parseBrokersFromUrl(apiUrl: string): string[] {
    try {
      const url = new URL(apiUrl);
      // Extract host and port from the URL
      const broker = `${url.hostname}:${url.port || '9092'}`;
      return [broker];
    } catch (error) {
      console.warn('⚠️  Failed to parse broker URL, using default');
      return ['localhost:9092'];
    }
  }

  /**
   * Get consumer metrics (placeholder)
   */
  getMetrics(): { messagesProcessed: number; errors: number } {
    // TODO: Implement actual metrics tracking
    return {
      messagesProcessed: 0,
      errors: 0,
    };
  }
}
