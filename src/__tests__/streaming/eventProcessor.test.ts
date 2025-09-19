import { RealTimeEventProcessor } from '../../streaming/eventProcessor';
import { GSwapAPI } from '../../api/gswap';
import { BlockData, TransactionData, ActionData } from '../../streaming/types';
import { createMockKafkaMessage } from './testUtils';

// Mock the GSwapAPI
jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

// Mock the arbitrage detector
jest.mock('../../strategies/arbitrage', () => ({
  ArbitrageDetector: jest.fn().mockImplementation(() => ({
    detectOpportunitiesForSwap: jest.fn().mockResolvedValue([])
  }))
}));

describe('RealTimeEventProcessor', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let eventProcessor: RealTimeEventProcessor;

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
      }
    ]);
    mockApi.checkTradingFunds.mockResolvedValue({
      hasFunds: true,
      currentBalance: 10000,
      shortfall: 0
    });

    eventProcessor = new RealTimeEventProcessor(mockApi);
  });

  describe('Block Processing', () => {
    it('should process a valid block with transactions', async () => {
      const blockData: BlockData = {
        blockNumber: '506599',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:27.056Z',
        isConfigurationBlock: false,
        header: {
          number: '506599',
          previous_hash: '0x123',
          data_hash: '0x456'
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
                  payload: '{"Data":"eth|4468b0113C24eADf56a022b0c6fB4139f3b13487","Status":1}'
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
                          zeroForOne: true,
                          token0: {
                            collection: 'eth',
                            category: 'Unit',
                            type: 'none',
                            additionalKey: '4468b0113C24eADf56a022b0c6fB4139f3b13487'
                          },
                          token1: {
                            collection: 'GALA',
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
                          uniqueKey: 'test-unique-key-123'
                        },
                        uniqueId: 'test-unique-id-456'
                      }
                    ],
                    uniqueKey: 'batch-unique-key-789',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: {
                      traceId: 'test-trace-id',
                      spanId: 'test-span-id'
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
      };

      await eventProcessor.processBlock(blockData);

      // Verify that transactions were processed
      expect(mockApi.createTokenClassKey).toHaveBeenCalled();
      expect(mockApi.isTokenAvailableByClassKey).toHaveBeenCalled();
    });

    it('should skip non-asset-channel blocks', async () => {
      const blockData: BlockData = {
        blockNumber: '506600',
        channelName: 'non-asset-channel',
        createdAt: '2025-09-19T15:55:28.000Z',
        isConfigurationBlock: false,
        header: {
          number: '506600',
          previous_hash: '0x789',
          data_hash: '0xabc'
        },
        transactions: [],
        configtxs: []
      };

      await eventProcessor.processBlock(blockData);

      // Should not process any transactions
      expect(mockApi.createTokenClassKey).not.toHaveBeenCalled();
    });

    it('should avoid processing the same block twice', async () => {
      const blockData: BlockData = {
        blockNumber: '506601',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:29.000Z',
        isConfigurationBlock: false,
        header: {
          number: '506601',
          previous_hash: '0xdef',
          data_hash: '0x123'
        },
        transactions: [],
        configtxs: []
      };

      // Process the same block twice
      await eventProcessor.processBlock(blockData);
      await eventProcessor.processBlock(blockData);

      // Should only process once
      expect(mockApi.createTokenClassKey).not.toHaveBeenCalled();
    });
  });

  describe('Transaction Processing', () => {
    it('should process transactions with DexV3Contract:BatchSubmit actions', async () => {
      const transactionData: TransactionData = {
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
                      uniqueKey: 'test-unique-key-456'
                    },
                    uniqueId: 'test-unique-id-789'
                  }
                ],
                uniqueKey: 'batch-unique-key-123',
                signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                trace: {
                  traceId: 'test-trace-id-2',
                  spanId: 'test-span-id-2'
                }
              })
            ],
            chaincode: {
              name: 'basic-asset',
              version: '50527314'
            }
          }
        ]
      };

      await eventProcessor.processTransaction(transactionData);

      // Verify that the action was processed
      expect(mockApi.createTokenClassKey).toHaveBeenCalled();
    });

    it('should skip transactions without DexV3Contract:BatchSubmit actions', async () => {
      const transactionData: TransactionData = {
        id: 'test-tx-3',
        creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
        type: 'ENDORSER_TRANSACTION',
        validationCode: {
          transactionId: 'test-tx-3',
          validationCode: 0,
          validationEnum: 'VALID'
        },
        actions: [
          {
            chaincodeResponse: {
              status: 200,
              message: '',
              payload: '{"Data":"other-data","Status":1}'
            },
            reads: [],
            writes: [],
            endorserMsps: ['CuratorOrg'],
            args: [
              'OtherContract:OtherMethod',
              '{"some": "data"}'
            ],
            chaincode: {
              name: 'other-contract',
              version: '1.0.0'
            }
          }
        ]
      };

      await eventProcessor.processTransaction(transactionData);

      // Should not process non-swap actions
      expect(mockApi.createTokenClassKey).not.toHaveBeenCalled();
    });

    it('should avoid processing the same transaction twice', async () => {
      const transactionData: TransactionData = {
        id: 'test-tx-4',
        creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
        type: 'ENDORSER_TRANSACTION',
        validationCode: {
          transactionId: 'test-tx-4',
          validationCode: 0,
          validationEnum: 'VALID'
        },
        actions: []
      };

      // Process the same transaction twice
      await eventProcessor.processTransaction(transactionData);
      await eventProcessor.processTransaction(transactionData);

      // Should only process once
      expect(mockApi.createTokenClassKey).not.toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    it('should track processing statistics', async () => {
      const blockData: BlockData = {
        blockNumber: '506602',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:30.000Z',
        isConfigurationBlock: false,
        header: {
          number: '506602',
          previous_hash: '0x456',
          data_hash: '0x789'
        },
        transactions: [],
        configtxs: []
      };

      await eventProcessor.processBlock(blockData);

      const stats = eventProcessor.getStats();
      expect(stats.blocksProcessed).toBe(1);
      expect(stats.blocksFiltered).toBe(0);
      expect(stats.opportunitiesFound).toBe(0);
      expect(stats.tradesExecuted).toBe(0);
    });

    it('should track filtered blocks', async () => {
      const blockData: BlockData = {
        blockNumber: '506603',
        channelName: 'non-asset-channel',
        createdAt: '2025-09-19T15:55:31.000Z',
        isConfigurationBlock: false,
        header: {
          number: '506603',
          previous_hash: '0xabc',
          data_hash: '0xdef'
        },
        transactions: [],
        configtxs: []
      };

      await eventProcessor.processBlock(blockData);

      const stats = eventProcessor.getStats();
      expect(stats.blocksProcessed).toBe(0);
      expect(stats.blocksFiltered).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle processing errors gracefully', async () => {
      // Mock API to throw an error
      mockApi.createTokenClassKey.mockImplementation(() => {
        throw new Error('API Error');
      });

      const blockData: BlockData = {
        blockNumber: '506604',
        channelName: 'asset-channel',
        createdAt: '2025-09-19T15:55:32.000Z',
        isConfigurationBlock: false,
        header: {
          number: '506604',
          previous_hash: '0x123',
          data_hash: '0x456'
        },
        transactions: [
          {
            id: 'test-tx-5',
            creator: { mspId: 'CuratorOrg', name: 'Client|ops' },
            type: 'ENDORSER_TRANSACTION',
            validationCode: {
              transactionId: 'test-tx-5',
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
                          uniqueKey: 'test-unique-key-789'
                        },
                        uniqueId: 'test-unique-id-123'
                      }
                    ],
                    uniqueKey: 'batch-unique-key-456',
                    signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    trace: {
                      traceId: 'test-trace-id-3',
                      spanId: 'test-span-id-3'
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
      };

      // Should not throw an error
      await expect(eventProcessor.processBlock(blockData)).resolves.not.toThrow();
    });
  });
});
