import { EachMessagePayload } from 'kafkajs';
import { blockValueMock } from '../mock/block-value.mock';

/**
 * Parse the binary data from block-value-example.txt into a Buffer
 */
export function parseBlockValueExample(): Buffer {
  // Extract the Uint8Array from the file content
  const uint8ArrayMatch = blockValueMock.match(/new Uint8Array\(\[(.*?)\]\)/);
  if (!uint8ArrayMatch) {
    throw new Error('Could not parse Uint8Array from block-value-example.txt');
  }
  
  // Parse the array values
  const arrayValues = uint8ArrayMatch[1]
    .split(',')
    .map(val => parseInt(val.trim(), 10));
  
  return Buffer.from(arrayValues);
}

/**
 * Create a mock Kafka message payload using the block value example
 */
export function createMockKafkaMessage(): EachMessagePayload {
  const messageValue = parseBlockValueExample();
  
  return {
    topic: 'test-topic',
    partition: 0,
    message: {
      key: Buffer.from('test-key'),
      value: messageValue,
      headers: {},
      timestamp: Date.now().toString(),
      offset: '12345',
      attributes: 0,
    },
    heartbeat: async () => {},
    pause: () => () => {},
  };
}

/**
 * Mock schema registry for testing
 */
export class MockSchemaRegistry {
  private mockDecodedData: any = null;
  
  constructor(mockDecodedData?: any) {
    this.mockDecodedData = mockDecodedData || this.createDefaultMockData();
  }
  
  async decode(buffer: Buffer): Promise<any> {
    // Simulate Avro decoding
    return this.mockDecodedData;
  }
  
  private createDefaultMockData() {
    return {
      blockNumber: '506599',
      channelName: 'poker',
      createdAt: '2025-09-19T15:55:27.056Z',
      isConfigurationBlock: false,
      header: {
        number: '506599',
        previous_hash: '',
        data_hash: ''
      },
      transactions: [
        {
          id: 'f18bf15f4ce4e8493ea34138ea17c671180120106056051e87cbf9e805f667ab',
          creator: {
            mspId: 'CuratorOrg',
            name: 'Client|ops'
          },
          type: 'ENDORSER_TRANSACTION',
          validationCode: {
            transactionId: 'f18bf15f4ce4e8493ea34138ea17c671180120106056051e87cbf9e805f667ab',
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
  }
  
  setMockDecodedData(data: any) {
    this.mockDecodedData = data;
  }
}
