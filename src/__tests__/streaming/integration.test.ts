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

// Mock the arbitrage detector
jest.mock('../../strategies/arbitrage', () => ({
  ArbitrageDetector: jest.fn().mockImplementation(() => ({
    detectOpportunitiesForSwap: jest.fn().mockResolvedValue([
      {
        id: 'test-opportunity-1',
        tokenA: 'GALA',
        tokenB: 'GUSDC',
        tokenClassA: 'GALA|Unit|none|none',
        tokenClassB: 'GUSDC|Unit|none|none',
        buyPrice: 0.04,
        sellPrice: 0.041,
        profitPercentage: 2.5,
        estimatedProfit: 25,
        maxTradeAmount: 1000,
        buyQuote: {
          inputToken: 'GALA|Unit|none|none',
          outputToken: 'GUSDC|Unit|none|none',
          inputAmount: 1000,
          outputAmount: 25000,
          priceImpact: 0.01,
          feeTier: 3000,
          route: []
        },
        sellQuote: {
          inputToken: 'GUSDC|Unit|none|none',
          outputToken: 'GALA|Unit|none|none',
          inputAmount: 25000,
          outputAmount: 1025,
          priceImpact: 0.01,
          feeTier: 3000,
          route: []
        },
        hasFunds: true,
        currentBalance: 10000,
        shortfall: 0,
        timestamp: Date.now(),
        currentMarketPrice: 0.04,
        priceDiscrepancy: 2.5,
        confidence: 85
      }
    ])
  }))
}));

describe('Kafka Consumer Integration Tests', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let eventProcessor: RealTimeEventProcessor;
  let consumer: KafkaBlockConsumer;
  let kafkaConfig: KafkaConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock API
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    mockApi.createTokenClassKey.mockImplementation((data: any) => 
      `${data.collection}|${data.category}|${data.type}|${data.additionalKey}`
    );
    mockApi.isTokenAvailableByClassKey.mockReturnValue(true);
    mockApi.getAvailableTokens.mockResolvedValue([
      {
        symbol: 'GALA',
        tokenClass: 'GALA|Unit|none|none',
        name: 'GALA',
        decimals: 18,
        price: 0.04,
        priceChange24h: 2.5
      },
      {
        symbol: 'GUSDC',
        tokenClass: 'GUSDC|Unit|none|none',
        name: 'GUSDC',
        decimals: 6,
        price: 1.0,
        priceChange24h: 0.1
      },
      {
        symbol: 'GUSDT',
        tokenClass: 'GUSDT|Unit|none|none',
        name: 'GUSDT',
        decimals: 6,
        price: 1.0,
        priceChange24h: 0.05
      }
    ]);
    mockApi.checkTradingFunds.mockResolvedValue({
      hasFunds: true,
      currentBalance: 10000,
      shortfall: 0
    });
    mockApi.getQuote.mockResolvedValue({
      inputToken: 'GALA|Unit|none|none',
      outputToken: 'GUSDC|Unit|none|none',
      inputAmount: 1000,
      outputAmount: 25000,
      priceImpact: 0.01,
      feeTier: 3000,
      route: []
    });

    // Create event processor
    eventProcessor = new RealTimeEventProcessor(mockApi);

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
    consumer = new KafkaBlockConsumer(kafkaConfig, eventProcessor);
  });

  describe('End-to-End Message Processing', () => {
    it('should process a complete Kafka message and detect arbitrage opportunities', async () => {
      // Mock avsc to return data with transactions
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
          transactions: [
            {
              id: 'test-tx-integration',
              creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
              type: 'ENDORSER_TRANSACTION',
              validationCode: {
                transactionId: 'test-tx-integration',
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
                            token0: {
                              collection: 'GALA',
                              category: 'Unit',
                              type: 'none',
                              additionalKey: 'none'
                            },
                            token1: {
                              collection: 'GUSDC',
                              category: 'Unit',
                              type: 'none',
                              additionalKey: 'none'
                            },
                            amount: '1000000000000000000',
                            amountInMaximum: '2500000000',
                            fee: 3000,
                            sqrtPriceLimit: '79228162514264337593543950336',
                            recipient: '0x1234567890123456789012345678901234567890',
                            signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                            uniqueKey: 'test-unique-key-integration'
                          },
                          uniqueId: 'test-unique-id-integration'
                        }
                      ],
                      uniqueKey: 'batch-unique-key-integration',
                      signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                      trace: {
                        traceId: 'test-trace-id-integration',
                        spanId: 'test-span-id-integration'
                      }
                    })
                  ],
                  chaincode: {
                    name: 'basic-asset',
                    version: '50527314'
                  }
                }
              ]
            }
          ],
          configtxs: []
        })
      });

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Process the message
      await processMessage(mockMessage);

      // Verify that the block was processed
      const stats = eventProcessor.getStats();
      expect(stats.blocksProcessed).toBe(1);
      expect(stats.opportunitiesFound).toBe(1);
      expect(stats.tradesExecuted).toBe(1);
    });

    it('should handle multiple transactions in a single block', async () => {
      // Mock avsc to return data with multiple transactions
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506600',
          channelName: 'asset-channel',
          createdAt: '2025-09-19T15:55:28.000Z',
          isConfigurationBlock: false,
          header: {
            number: '506600',
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
                  chaincodeResponse: { status: 200, message: '', payload: '{"Data":"GALA|Unit|none|none","Status":1}' },
                  reads: [], writes: [], endorserMsps: ['CuratorOrg'],
                  args: ['DexV3Contract:BatchSubmit', JSON.stringify({
                    operations: [{
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
                        uniqueKey: 'test-unique-key-1'
                      },
                      uniqueId: 'test-unique-id-1'
                    }],
                    uniqueKey: 'batch-unique-key-1',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: { traceId: 'test-trace-id-1', spanId: 'test-span-id-1' }
                  })],
                  chaincode: { name: 'basic-asset', version: '50527314' }
                }
              ]
            },
            {
              id: 'test-tx-2',
              creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
              type: 'ENDORSER_TRANSACTION',
              validationCode: {
                transactionId: 'test-tx-2',
                validationCode: 0,
                validationEnum: 'VALID'
              },
              actions: [
                {
                  chaincodeResponse: { status: 200, message: '', payload: '{"Data":"GUSDC|Unit|none|none","Status":1}' },
                  reads: [], writes: [], endorserMsps: ['CuratorOrg'],
                  args: ['DexV3Contract:BatchSubmit', JSON.stringify({
                    operations: [{
                      method: 'Swap',
                      dto: {
                        zeroForOne: true,
                        token0: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
                        token1: { collection: 'GUSDT', category: 'Unit', type: 'none', additionalKey: 'none' },
                        amount: '1000000',
                        amountInMaximum: '1000000',
                        fee: 3000,
                        sqrtPriceLimit: '79228162514264337593543950336',
                        recipient: '0x1234567890123456789012345678901234567890',
                        signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                        uniqueKey: 'test-unique-key-2'
                      },
                      uniqueId: 'test-unique-id-2'
                    }],
                    uniqueKey: 'batch-unique-key-2',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: { traceId: 'test-trace-id-2', spanId: 'test-span-id-2' }
                  })],
                  chaincode: { name: 'basic-asset', version: '50527314' }
                }
              ]
            }
          ],
          configtxs: []
        })
      });

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      await processMessage(mockMessage);

      // Should process both transactions (each has 2 tokens: token0 and token1)
      expect(mockApi.createTokenClassKey).toHaveBeenCalledTimes(4);
    });

    it('should handle errors gracefully during processing', async () => {
      // Mock API to throw an error
      mockApi.createTokenClassKey.mockImplementation(() => {
        throw new Error('API Error');
      });

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Should not throw an error
      await expect(processMessage(mockMessage)).resolves.not.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency message processing', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => createMockKafkaMessage());
      
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Process multiple messages concurrently
      const promises = messages.map(message => processMessage(message));
      
      // Should not throw errors
      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should maintain deduplication under load', async () => {
      // Mock avsc to return data with transaction
      const avsc = require('avsc');
      avsc.Type.forSchema.mockReturnValue({
        fromBuffer: jest.fn().mockReturnValue({
          blockNumber: '506601',
          channelName: 'asset-channel',
          createdAt: '2025-09-19T15:55:29.000Z',
          isConfigurationBlock: false,
          header: {
            number: '506601',
            previous_hash: '',
            data_hash: ''
          },
          transactions: [
            {
              id: 'test-tx-dedup',
              creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
              type: 'ENDORSER_TRANSACTION',
              validationCode: {
                transactionId: 'test-tx-dedup',
                validationCode: 0,
                validationEnum: 'VALID'
              },
              actions: [
                {
                  chaincodeResponse: { status: 200, message: '', payload: '{"Data":"GALA|Unit|none|none","Status":1}' },
                  reads: [], writes: [], endorserMsps: ['CuratorOrg'],
                  args: ['DexV3Contract:BatchSubmit', JSON.stringify({
                    operations: [{
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
                        uniqueKey: 'test-unique-key-dedup'
                      },
                      uniqueId: 'test-unique-id-dedup'
                    }],
                    uniqueKey: 'batch-unique-key-dedup',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: { traceId: 'test-trace-id-dedup', spanId: 'test-span-id-dedup' }
                  })],
                  chaincode: { name: 'basic-asset', version: '50527314' }
                }
              ]
            }
          ],
          configtxs: []
        })
      });

      const mockMessage = createMockKafkaMessage();
      const processMessage = (consumer as any).processMessage.bind(consumer);
      
      // Process the same message multiple times
      await processMessage(mockMessage);
      await processMessage(mockMessage);
      await processMessage(mockMessage);

      // Should only process once due to deduplication (2 tokens: token0 and token1)
      expect(mockApi.createTokenClassKey).toHaveBeenCalledTimes(2);
    });
  });
});
