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
      // Early filter: Skip non-asset-channel blocks for efficiency
      if (data.channelName && data.channelName !== 'asset-channel') {
        console.log(`⏭️  Skipping non-asset-channel block from channel: ${data.channelName}`);
        return;
      }

      // Parse the real block data structure
      const blockData: BlockData = {
        blockNumber: data.blockNumber || '0',
        channelName: data.channelName || '',
        createdAt: data.createdAt || new Date().toISOString(),
        isConfigurationBlock: data.isConfigurationBlock || false,
        header: data.header || {
          number: data.blockNumber || '0',
          previous_hash: '',
          data_hash: ''
        },
        transactions: data.transactions || [],
        configtxs: data.configtxs || [],
      };

      console.log(`📦 Processing asset-channel block ${blockData.blockNumber} with ${blockData.transactions.length} transactions`);
      
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
        blockNumber: data.blockNumber || '0',
        transactionId: data.transactionId || '',
        timestamp: data.timestamp || new Date().toISOString(),
        channelName: data.channelName || '',
        user: data.user || '',
        operation: data.operation || {} as any,
        tokenIn: data.tokenIn || '',
        tokenOut: data.tokenOut || '',
        amountIn: data.amountIn || '0',
        amountOut: data.amountOut || '0',
        fee: data.fee || 0,
        priceImpact: data.priceImpact || 0,
        dex: data.dex || 'GalaSwap',
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
      // Parse the real transaction data structure
      const txData: TransactionData = {
        id: data.id || '',
        creator: data.creator || { mspId: '', name: '' },
        type: data.type || '',
        validationCode: data.validationCode || {
          transactionId: '',
          validationCode: 0,
          validationEnum: 'UNKNOWN'
        },
        actions: data.actions || [],
      };

      // Process all transactions (we'll filter for DexV3Contract:BatchSubmit in the processor)
      console.log(`🔍 Analyzing transaction: ${txData.id}`);
      await this.eventProcessor.processTransaction(txData);

    } catch (error) {
      console.error('❌ Error processing transaction message:', error);
    }
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
