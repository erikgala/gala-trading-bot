import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { BlockData, KafkaConfig, EventProcessor } from './types';
import avro from 'avsc';
import { parsedBlockSchema } from './parsed-block.schema';
import { RateLimiter } from './rateLimiter';

export class KafkaBlockConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private eventProcessor: EventProcessor;
  private isRunning: boolean = false;
  private topic: string;
  private rateLimiter: RateLimiter;
  private isPaused: boolean = false;

  constructor(config: KafkaConfig, eventProcessor: EventProcessor, rateLimiter?: RateLimiter) {
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
      // Configure message handling
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    this.consumer = this.kafka.consumer({ 
      groupId: config.groupId || 'gala-trading-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      minBytes: 1,
      maxBytes: 10485760, // 10MB
      maxWaitTimeInMs: 5000,
      allowAutoTopicCreation: false
    });
    this.eventProcessor = eventProcessor;
    this.topic = config.topic;
    this.rateLimiter = rateLimiter || new RateLimiter();
  }

  /**
   * Start consuming Kafka messages
   */
  async start(): Promise<void> {
    try {
      await this.consumer.connect();

      // Subscribe to the configured topic
      await this.consumer.subscribe({ 
        topic: this.topic,
        fromBeginning: false 
      });

      // Start consuming messages with enhanced configuration
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
        // Additional consumer options for better message handling
        autoCommit: true,
        autoCommitInterval: 5000,
        autoCommitThreshold: 100,
        // Handle message processing errors gracefully
        eachBatch: undefined, // We're using eachMessage instead
        // Configure message processing
        partitionsConsumedConcurrently: 1, // Process one partition at a time for order
      });

      this.isRunning = true;

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
      this.isRunning = false;
      await this.consumer.disconnect();
    } catch (error) {
      console.error('❌ Error stopping Kafka consumer:', error);
    }
  }

  /**
   * Deserialize message value using Avro schema registry with JSON fallback
   */
  private async deserializeMessageValue(buffer: Buffer): Promise<any> {
    try {
      // Check if this is a Confluent Avro message (with magic byte and schema ID)
      if (buffer.length >= 5 && buffer[0] === 0x00) {
        const dataBuffer = buffer.subarray(5);
        const type = avro.Type.forSchema(parsedBlockSchema as any);
        return type.fromBuffer(dataBuffer);
      } else {
        // Try direct Avro decoding
        console.log('📄 Direct Avro message detected');
        const type = avro.Type.forSchema(parsedBlockSchema as any);
        return type.fromBuffer(buffer);
      }
    } catch (e) {
      console.log('⚠️  Avro decoding failed:', e instanceof Error ? e.message : String(e));
      
      // Fallback to JSON parsing if Avro decoding fails
      try {
        const jsonString = buffer.toString('utf8');
        return JSON.parse(jsonString);
      } catch (jsonError) {
        console.warn('⚠️  Failed to decode message with both Avro and JSON:', e);
        return null;
      }
    }
  }

  /**
   * Process incoming Kafka messages
   */
  private async processMessage(payload: EachMessagePayload): Promise<void> {
    try {
      // Check if we're rate limited
      if (this.rateLimiter.isCurrentlyRateLimited()) {
        if (!this.isPaused) {
          this.isPaused = true;
          console.log(`⏸️  Pausing message processing due to rate limit. Resuming in ${this.rateLimiter.getTimeRemainingFormatted()}`);
        }
        return; // Skip processing this message
      }

      // Resume processing if we were paused
      if (this.isPaused) {
        this.isPaused = false;
        console.log('▶️  Resuming message processing - rate limit expired');
      }

      const { topic, message } = payload;
      
      if (!message.value) {
        console.warn('⚠️  Received empty message');
        return;
      }

      // Try to deserialize the message value using Avro schema registry
      const messageData = await this.deserializeMessageValue(message.value);
      
      if (!messageData) {
        console.warn('⚠️  Failed to decode message value');
        return;
      }
      
      // Process the decoded message as block data
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
      // If data is null or not an object, skip processing
      if (!data || typeof data !== 'object') {
        return;
      }

      // Early filter: Skip non-asset-channel blocks for efficiency
      if (data.channelName && data.channelName !== 'asset-channel') {
        return;
      }

      // The Avro schema should provide a clean, structured block data object
      // No need for complex parsing - the schema registry handles the decoding
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

      await this.eventProcessor.processBlock(blockData);

    } catch (error) {
      console.error('❌ Error processing block message:', error);
    }
  }




  /**
   * Trigger rate limiting - pause message processing
   */
  triggerRateLimit(): void {
    this.rateLimiter.triggerRateLimit();
  }

  /**
   * Get consumer status
   */
  getStatus(): { 
    isRunning: boolean; 
    connected: boolean; 
    isPaused: boolean;
    rateLimitStatus: {
      isRateLimited: boolean;
      timeRemaining: number;
      timeRemainingFormatted: string;
    };
  } {
    return {
      isRunning: this.isRunning,
      connected: this.consumer ? true : false, // Simplified check
      isPaused: this.isPaused,
      rateLimitStatus: this.rateLimiter.getStatus(),
    };
  }


  /**
   * Parse broker URLs from API URL
   */
  private parseBrokersFromUrl(apiUrl: string): string[] {
    try {
      // Handle different URL formats
      let url: URL;
      if (apiUrl.startsWith('http://') || apiUrl.startsWith('https://')) {
        url = new URL(apiUrl);
      } else {
        // If no protocol, assume it's just host:port
        if (apiUrl.includes(':')) {
          const [hostname, port] = apiUrl.split(':');
          return [`${hostname}:${port}`];
        } else {
          // Just hostname, use default port
          return [`${apiUrl}:9092`];
        }
      }
      
      // Extract host and port from the URL
      const broker = `${url.hostname}:${url.port || '9092'}`;
      return [broker];
    } catch (error) {
      console.warn(`⚠️  Failed to parse broker URL: ${apiUrl}, error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.warn('⚠️  Using default localhost:9092');
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
