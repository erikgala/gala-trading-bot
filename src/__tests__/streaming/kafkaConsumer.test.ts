import { KafkaBlockConsumer } from '../../streaming/kafkaConsumer';
import { RealTimeEventProcessor } from '../../streaming/eventProcessor';
import { GSwapAPI } from '../../api/gswap';
import { createMockKafkaMessage } from './testUtils';
import { KafkaConfig } from '../../streaming/types';

// Mock the avsc library
jest.mock('avsc', () => ({
  Type: {
    forSchema: jest.fn().mockReturnValue({
      fromBuffer: jest.fn().mockReturnValue({
        blockNumber: '506599',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        header: {
          number: '506599',
          previous_hash: '',
          data_hash: ''
        },
        transactions: [],
        configtxs: []
      })
    })
  }
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
      topic: 'test-topic',
      clientId: 'test-client',
      groupId: 'test-group'
    };

    // Create consumer
    consumer = new KafkaBlockConsumer(kafkaConfig, mockEventProcessor);
  });

  describe('Message Processing', () => {
    it('should process a valid Kafka message with Avro decoding', async () => {
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
          value: null,
          key: null,
          timestamp: '1234567890',
          attributes: 0
        }
      };
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(emptyMessage);

      // Should not call processBlock for empty message
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should filter out non-asset-channel blocks', async () => {
      // Mock avsc to return non-asset-channel data
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506600',
          channelName: 'non-asset-channel', // Different channel
          createdAt: '2025-09-19T15:55:28.000Z',
          isConfigurationBlock: false,
          header: { number: '506600', previous_hash: '', data_hash: '' },
          transactions: [],
          configtxs: []
        })
      });

      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Should not call processBlock for non-asset-channel
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should handle Avro decoding errors gracefully', async () => {
      // Mock avsc to throw an error
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockImplementation(() => {
          throw new Error('Avro decoding failed');
        })
      });

      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Should not crash and should not call processBlock
      expect(mockEventProcessor.processBlock).not.toHaveBeenCalled();
    });

    it('should handle JSON fallback when Avro fails', async () => {
      // Mock avsc to throw an error, then mock JSON parsing
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockImplementation(() => {
          throw new Error('Avro decoding failed');
        })
      });

      const mockMessage = createMockKafkaMessage();
      // Make the message value a JSON string
      mockMessage.message.value = Buffer.from(JSON.stringify({
        blockNumber: '506601',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:29.000Z',
        isConfigurationBlock: false,
        header: { number: '506601', previous_hash: '', data_hash: '' },
        transactions: [],
        configtxs: []
      }));
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Should call processBlock with JSON data
      expect(mockEventProcessor.processBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Avro Decoding', () => {
    it('should use avsc library for message decoding', async () => {
      // Reset the mock to ensure it's called
      mockEventProcessor.processBlock.mockClear();
      
      // Ensure avsc mock is set up
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506599',
          channelName: 'asset-channel',
          createdAt: '2025-09-19T15:55:27.056Z',
          isConfigurationBlock: false,
          header: {
            number: '506599',
            previous_hash: '',
            data_hash: ''
          },
          transactions: [],
          configtxs: []
        })
      });
      
      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Verify that processBlock was called with decoded data
      expect(mockEventProcessor.processBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle processing errors without crashing', async () => {
      // Mock processBlock to throw an error
      mockEventProcessor.processBlock.mockRejectedValue(new Error('Processing failed'));

      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw
      await expect(processMessage(mockMessage)).resolves.not.toThrow();
    });

    it('should handle malformed message data', async () => {
      const malformedMessage = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from('invalid data'),
          key: null,
          timestamp: '1234567890',
          attributes: 0
        }
      };
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw
      await expect(processMessage(malformedMessage)).resolves.not.toThrow();
    });
  });

  describe('Message Structure Validation', () => {
    it('should correctly parse block data structure', async () => {
      // Reset the mock to ensure it's called
      mockEventProcessor.processBlock.mockClear();
      
      // Ensure avsc mock is set up
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506599',
          channelName: 'asset-channel',
          createdAt: '2025-09-19T15:55:27.056Z',
          isConfigurationBlock: false,
          header: {
            number: '506599',
            previous_hash: '',
            data_hash: ''
          },
          transactions: [],
          configtxs: []
        })
      });
      
      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      expect(mockEventProcessor.processBlock).toHaveBeenCalledTimes(1);
      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      
      // Validate block structure
      expect(processedData).toHaveProperty('blockNumber');
      expect(processedData).toHaveProperty('channelName');
      expect(processedData).toHaveProperty('createdAt');
      expect(processedData).toHaveProperty('isConfigurationBlock');
      expect(processedData).toHaveProperty('header');
      expect(processedData).toHaveProperty('transactions');
      expect(processedData).toHaveProperty('configtxs');
    });

    it('should handle transactions with swap operations', async () => {
      // Mock avsc to return data with transactions
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506602',
          channelName: 'asset-channel',
          createdAt: '2025-09-19T15:55:30.000Z',
          isConfigurationBlock: false,
          header: { number: '506602', previous_hash: '', data_hash: '' },
          transactions: [
            {
              id: 'tx-1',
              creator: { mspId: 'test-msp', name: 'test-creator' },
              type: 'ENDORSER_TRANSACTION',
              validationCode: { transactionId: 'tx-1', validationCode: 0, validationEnum: 'VALID' },
              actions: []
            }
          ],
          configtxs: []
        })
      });

      const mockMessage = createMockKafkaMessage();
      
      // Access the private processMessage method for testing
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      const processedData = mockEventProcessor.processBlock.mock.calls[0][0];
      
      // Should have transactions
      expect(processedData.transactions.length).toBeGreaterThan(0);
      expect(processedData.transactions[0]).toHaveProperty('id');
      expect(processedData.transactions[0]).toHaveProperty('creator');
      expect(processedData.transactions[0]).toHaveProperty('type');
    });
  });
});
