import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { BlockData, TransactionData, KafkaConfig, EventProcessor } from './types';

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
   * Deserialize message value with JSON fallback
   */
  private deserializeMessageValue(buffer: Buffer): any {
    try {
      // Try to parse as JSON first
      const jsonString = buffer.toString('utf8');
      return JSON.parse(jsonString);
    } catch (e) {
      // If not JSON, return the buffer for custom parsing
      return buffer;
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

      let messageData: any = null;

      // Try to deserialize the message value
      const deserializedValue = this.deserializeMessageValue(message.value);
      
      if (typeof deserializedValue === 'object' && !Buffer.isBuffer(deserializedValue)) {
        // Successfully deserialized as JSON
        messageData = deserializedValue;
      } else {
        // Still binary data, need custom decoding
        messageData = this.decodeMessageValue(deserializedValue);
      }
      
      if (!messageData) {
        console.warn('⚠️  Failed to decode message value');
        return;
      }
      
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
      // If data is null or not an object, skip processing
      if (!data || typeof data !== 'object') {
        return;
      }

      // Early filter: Skip non-asset-channel blocks for efficiency
      if (data.channelName && data.channelName !== 'asset-channel') {
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
   * Decode binary message value to extract block data
   */
  private decodeMessageValue(value: Buffer): any | null {
    try {
      // Convert Uint8Array to Buffer if needed
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      
      // The message appears to be protobuf-encoded binary data
      // Based on the user's example, it contains structured data that needs to be parsed
      const dataString = buffer.toString('utf8');
      
      // Extract block number (appears to be the first number in the string)
      const blockNumberMatch = dataString.match(/^(\d+)/);
      const blockNumber = blockNumberMatch ? blockNumberMatch[1] : 'unknown';
      
      // Extract channel name
      const channelNameMatch = dataString.match(/asset-channel/);
      const channelName = channelNameMatch ? 'asset-channel' : 'unknown';
      
      // Extract timestamp (ISO format)
      const timestampMatch = dataString.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      const createdAt = timestampMatch ? timestampMatch[1] : new Date().toISOString();
      
      // Extract transaction ID (appears after the creator info)
      const transactionIdMatch = dataString.match(/([a-f0-9]{64})/);
      const transactionId = transactionIdMatch ? transactionIdMatch[0] : '';
      
      // Extract creator info
      const creatorMatch = dataString.match(/GalaUsersOrg\s+Client\|galausers/);
      const creator = creatorMatch ? {
        mspId: 'GalaUsersOrg',
        name: 'Client|galausers'
      } : { mspId: '', name: '' };
      
      // Extract transaction type
      const typeMatch = dataString.match(/ENDORSER_TRANSACTION/);
      const type = typeMatch ? 'ENDORSER_TRANSACTION' : 'UNKNOWN';
      
      // Extract validation status
      const validationMatch = dataString.match(/VALID/);
      const validationCode = validationMatch ? {
        transactionId: transactionId,
        validationCode: 0,
        validationEnum: 'VALID'
      } : {
        transactionId: transactionId,
        validationCode: 1,
        validationEnum: 'INVALID'
      };
      
      // Extract JSON payload from the swap operation
      const jsonPayloadMatch = dataString.match(/\{"Data":\[.*?\],"Status":\d+\}/);
      let chaincodeResponse = null;
      if (jsonPayloadMatch) {
        try {
          chaincodeResponse = JSON.parse(jsonPayloadMatch[0]);
        } catch (e) {
          console.warn('⚠️  Could not parse chaincode response JSON');
        }
      }
      
      // Extract the DexV3Contract:BatchSubmit JSON
      const batchSubmitMatch = dataString.match(/\{"operations":\[.*?\],"uniqueKey":"[^"]+","signature":"[^"]+","trace":\{[^}]+\}\}/);
      let batchSubmitData = null;
      if (batchSubmitMatch) {
        try {
          batchSubmitData = JSON.parse(batchSubmitMatch[0]);
        } catch (e) {
          console.warn('⚠️  Could not parse batch submit JSON');
        }
      }
      
      // Construct the transaction
      const transaction = {
        id: transactionId,
        creator: creator,
        type: type,
        validationCode: validationCode,
        actions: [{
          chaincodeResponse: chaincodeResponse ? {
            status: 200,
            message: '',
            payload: JSON.stringify(chaincodeResponse)
          } : {
            status: 0,
            message: '',
            payload: ''
          },
          reads: [],
          writes: [],
          endorserMsps: ['CuratorOrg'],
          args: batchSubmitData ? [
            'DexV3Contract:BatchSubmit',
            JSON.stringify(batchSubmitData)
          ] : [],
          chaincode: {
            name: 'basic-asset',
            version: '50527314'
          }
        }]
      };
      
      // Construct the block data structure
      const blockData = {
        blockNumber: blockNumber,
        channelName: channelName,
        createdAt: createdAt,
        isConfigurationBlock: false,
        header: {
          number: blockNumber,
          previous_hash: '',
          data_hash: ''
        },
        transactions: [transaction],
        configtxs: []
      };
      
      
      return blockData;
      
    } catch (error) {
      console.error('❌ Error decoding message value:', error);
      return null;
    }
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
