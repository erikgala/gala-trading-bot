import { KafkaBlockConsumer } from '../../streaming/kafkaConsumer';
import { RealTimeEventProcessor } from '../../streaming/eventProcessor';
import { GSwapAPI } from '../../api/gswap';
import { createMockKafkaMessage, MockSchemaRegistry } from './testUtils';
import { KafkaConfig } from '../../streaming/types';

// Mock the schema registry
jest.mock('@kafkajs/confluent-schema-registry', () => ({
  SchemaRegistry: jest.fn().mockImplementation(() => new MockSchemaRegistry()),
}));

// Mock the GSwapAPI
jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

// Mock the event processor
jest.mock('../../streaming/eventProcessor');
const MockedEventProcessor = RealTimeEventProcessor as jest.MockedClass<typeof RealTimeEventProcessor>;

describe('KafkaBlockConsumer', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let mockEventProcessor: jest.Mocked<RealTimeEventProcessor>;
  let kafkaConfig: KafkaConfig;
  let consumer: KafkaBlockConsumer;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock API
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    mockApi.createTokenClassKey.mockImplementation((data: any) => 
      `${data.collection}|${data.category}|${data.type}|${data.additionalKey}`
    );
    mockApi.isTokenAvailableByClassKey.mockReturnValue(true);

    // Create mock event processor
    mockEventProcessor = new MockedEventProcessor(mockApi) as jest.Mocked<RealTimeEventProcessor>;
    mockEventProcessor.processBlock.mockResolvedValue();

    // Create Kafka config
    kafkaConfig = {
      apiUrl: 'https://test-kafka.example.com:9092',
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      schemaHost: 'https://test-schema.example.com:8081',
      schemaUsername: 'test-schema-user',
      schemaPassword: 'test-schema-pass',
      topic: 'test-topic',
      clientId: 'test-client',
      groupId: 'test-group'
    };

    // Create consumer
    consumer = new KafkaBlockConsumer(kafkaConfig, mockEventProcessor);
  });

  describe('Message Processing', () => {
    it('should process a valid Kafka message with Avro decoding', async () => {
      // Create a mock schema registry that returns our test data
      const mockSchemaRegistry = new MockSchemaRegistry({
        blockNumber: '506599',
        channelName: 'asset-channel', // Make sure it's asset-channel to pass the filter
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        header: {
          number: '506599',
          previous_hash: '',
          data_hash: ''
        },
        transactions: [],
        configtxs: []
      });

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Verify that processBlock was called with the decoded data
      expect(mockEventProcessor.processBlock).toHaveBeenCalledTimes(1);
      
      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      expect(processedData).toMatchObject({
        blockNumber: '506599',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        transactions: expect.any(Array),
        configtxs: expect.any(Array)
      });
    });

    it('should handle empty message gracefully', async () => {
      const emptyMessage = {
        topic: 'test-topic',
        partition: 0,
        message: {
          key: Buffer.from('test-key'),
          value: null, // Empty message
          headers: {},
          timestamp: Date.now().toString(),
          offset: '12345',
          size: 0,
        },
        heartbeat: async () => {},
        pause: () => {},
        resume: () => {},
      };

      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw an error
      await expect(processMessage(emptyMessage)).resolves.not.toThrow();
      
      // Should not call processBlock
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should filter out non-asset-channel blocks', async () => {
      const mockSchemaRegistry = new MockSchemaRegistry({
        blockNumber: '506600',
        channelName: 'non-asset-channel', // Different channel
        createdAt: '2025-09-19T15:55:28.000Z',
        isConfigurationBlock: false,
        header: { number: '506600', previous_hash: '', data_hash: '' },
        transactions: [],
        configtxs: []
      });

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Should not call processBlock for non-asset-channel
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should handle Avro decoding errors gracefully', async () => {
      const mockSchemaRegistry = new MockSchemaRegistry();
      mockSchemaRegistry.decode = jest.fn().mockRejectedValue(new Error('Avro decoding failed'));

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw an error
      await expect(processMessage(mockMessage)).resolves.not.toThrow();
      
      // Should not call processBlock due to decoding failure
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should handle JSON fallback when Avro fails', async () => {
      const mockSchemaRegistry = new MockSchemaRegistry();
      mockSchemaRegistry.decode = jest.fn().mockRejectedValue(new Error('Avro decoding failed'));

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      // Create a message with JSON data instead of binary
      const jsonMessage = {
        topic: 'test-topic',
        partition: 0,
        message: {
          key: Buffer.from('test-key'),
          value: Buffer.from(JSON.stringify({
            blockNumber: '506601',
            channelName: 'asset-channel',
            createdAt: '2025-09-19T15:55:29.000Z',
            isConfigurationBlock: false,
            header: { number: '506601', previous_hash: '', data_hash: '' },
            transactions: [],
            configtxs: []
          })),
          headers: {},
          timestamp: Date.now().toString(),
          offset: '12346',
          size: 100,
        },
        heartbeat: async () => {},
        pause: () => {},
        resume: () => {},
      };

      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(jsonMessage);

      // Should call processBlock with JSON-decoded data
      expect(mockEventProcessor.processBlock).toHaveBeenCalledTimes(1);
      
      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      expect(processedData).toMatchObject({
        blockNumber: '506601',
        channelName: 'asset-channel'
      });
    });
  });

  describe('Schema Registry Integration', () => {
    it('should initialize schema registry with correct configuration', () => {
      const SchemaRegistry = require('@kafkajs/confluent-schema-registry').SchemaRegistry;
      
      expect(SchemaRegistry).toHaveBeenCalledWith({
        host: kafkaConfig.schemaHost,
        auth: {
          username: kafkaConfig.schemaUsername,
          password: kafkaConfig.schemaPassword,
        },
      });
    });

    it('should use schema registry for message decoding', async () => {
      const mockSchemaRegistry = new MockSchemaRegistry();
      const decodeSpy = jest.spyOn(mockSchemaRegistry, 'decode');
      
      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Verify that decode was called with the message buffer
      expect(decodeSpy).toHaveBeenCalledWith(mockMessage.message.value);
    });
  });

  describe('Error Handling', () => {
    it('should handle processing errors without crashing', async () => {
      // Mock processBlock to throw an error
      mockEventProcessor.processBlock.mockRejectedValue(new Error('Processing failed'));

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw an error
      await expect(processMessage(mockMessage)).resolves.not.toThrow();
    });

    it('should handle malformed message data', async () => {
      const malformedMessage = {
        topic: 'test-topic',
        partition: 0,
        message: {
          key: Buffer.from('test-key'),
          value: Buffer.from('invalid-data'), // Invalid data
          headers: {},
          timestamp: Date.now().toString(),
          offset: '12347',
          size: 12,
        },
        heartbeat: async () => {},
        pause: () => {},
        resume: () => {},
      };

      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw an error
      await expect(processMessage(malformedMessage)).resolves.not.toThrow();
    });
  });

  describe('Message Structure Validation', () => {
    it('should correctly parse block data structure', async () => {
      // Create a mock schema registry that returns our test data
      const mockSchemaRegistry = new MockSchemaRegistry({
        blockNumber: '506599',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        header: {
          number: '506599',
          previous_hash: '0x123',
          data_hash: '0x456'
        },
        transactions: [],
        configtxs: []
      });

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      
      // Validate block structure
      expect(processedData).toHaveProperty('blockNumber');
      expect(processedData).toHaveProperty('channelName');
      expect(processedData).toHaveProperty('createdAt');
      expect(processedData).toHaveProperty('isConfigurationBlock');
      expect(processedData).toHaveProperty('header');
      expect(processedData).toHaveProperty('transactions');
      expect(processedData).toHaveProperty('configtxs');

      // Validate header structure
      expect(processedData.header).toHaveProperty('number');
      expect(processedData.header).toHaveProperty('previous_hash');
      expect(processedData.header).toHaveProperty('data_hash');

      // Validate transactions array
      expect(Array.isArray(processedData.transactions)).toBe(true);
      expect(Array.isArray(processedData.configtxs)).toBe(true);
    });

    it('should handle transactions with swap operations', async () => {
      // Create a mock schema registry that returns our test data with transactions
      const mockSchemaRegistry = new MockSchemaRegistry({
        blockNumber: '506599',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        header: {
          number: '506599',
          previous_hash: '',
          data_hash: ''
        },
        transactions: [
          {
            id: 'test-tx-1',
            creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
            type: 'ENDORSER_TRANSACTION',
            validationCode: {
              transactionId: 'test-tx-1',
              validationCode: 0,
              validationEnum: 'VALID'
            },
            actions: [
              {
                chaincodeResponse: {
                  status: 200,
                  message: '',
                  payload: '{"Data":"GALA|Unit|none|none","Status":1}'
                },
                reads: [],
                writes: [],
                endorserMsps: ['CuratorOrg'],
                args: [
                  'DexV3Contract:BatchSubmit',
                  JSON.stringify({
                    operations: [
                      {
                        method: 'Swap',
                        dto: {
                          zeroForOne: false,
                          token0: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
                          token1: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
                          amount: '1000000000000000000',
                          amountInMaximum: '2500000000',
                          fee: 3000,
                          sqrtPriceLimit: '79228162514264337593543950336',
                          recipient: '0x1234567890123456789012345678901234567890',
                          signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                          uniqueKey: 'test-unique-key-123'
                        },
                        uniqueId: 'test-unique-id-456'
                      }
                    ],
                    uniqueKey: 'batch-unique-key-789',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: { traceId: 'test-trace-id', spanId: 'test-span-id' }
                  })
                ],
                chaincode: { name: 'basic-asset', version: '50527314' }
              }
            ]
          }
        ],
        configtxs: []
      });

      // Replace the schema registry with our mock
      (consumer as any).schemaRegistry = mockSchemaRegistry;

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      
      // Should have transactions
      expect(processedData.transactions.length).toBeGreaterThan(0);
      
      const transaction = processedData.transactions[0];
      expect(transaction).toHaveProperty('id');
      expect(transaction).toHaveProperty('creator');
      expect(transaction).toHaveProperty('type');
      expect(transaction).toHaveProperty('validationCode');
      expect(transaction).toHaveProperty('actions');

      // Should have actions
      expect(transaction.actions.length).toBeGreaterThan(0);
      
      const action = transaction.actions[0];
      expect(action).toHaveProperty('args');
      expect(action.args.length).toBeGreaterThan(0);
      expect(action.args[0]).toBe('DexV3Contract:BatchSubmit');
    });
  });
});
