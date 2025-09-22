/**
 * Placeholder types for Kafka block data
 * These will be updated once we see the actual block data structure
 */

export interface BlockData {
  blockNumber: string;
  channelName: string;
  createdAt: string;
  isConfigurationBlock: boolean;
  header: {
    number: string;
    previous_hash: string;
    data_hash: string;
  };
  transactions: TransactionData[];
  configtxs: any[];
}

export interface TransactionData {
  id: string;
  creator: {
    mspId: string;
    name: string;
  };
  type: string;
  validationCode: {
    transactionId: string;
    validationCode: number;
    validationEnum: string;
  };
  actions: ActionData[];
}

export interface ActionData {
  chaincodeResponse: {
    status: number;
    message: string;
    payload: string;
  };
  reads: Array<{
    key: string;
  }>;
  writes: Array<{
    key: string;
    isDelete: boolean;
    value: string;
  }>;
  endorserMsps: string[];
  args: string[];
  chaincode: {
    name: string;
    version: string;
  };
}

export interface TokenInfo {
  type: string;
  category: string;
  collection: string;
  additionalKey: string;
}

export interface DexV3Operation {
  dto: {
    fee: number;
    amount: string;
    token0: TokenInfo;
    token1: TokenInfo;
    recipient: string;
    signature: string;
    uniqueKey: string;
    zeroForOne: boolean;
    sqrtPriceLimit: string;
    amountInMaximum: string;
  };
  method: string;
  uniqueId: string;
}

export interface DexV3BatchSubmit {
  operations: DexV3Operation[];
  uniqueKey: string;
  signature: string;
  trace: {
    traceId: string;
    spanId: string;
  };
}

export interface SwapEvent {
  blockNumber: string;
  transactionId: string;
  timestamp: string;
  channelName: string;
  user: string;
  operation: DexV3Operation;
  // Parsed from the operation
  tokenIn: string; // token0 or token1 based on zeroForOne
  tokenOut: string; // token1 or token0 based on zeroForOne
  amountIn: string;
  amountOut: string; // Calculated from price impact
  fee: number;
  priceImpact: number; // Calculated from sqrtPriceLimit
  dex: string; // "GalaSwap" or derived from channel
}

export interface KafkaConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  topic: string;
  // Additional Kafka configuration
  clientId?: string;
  groupId?: string;
}

export interface EventProcessor {
  processBlock(blockData: BlockData): Promise<void>;
  processTransaction(txData: TransactionData): Promise<void>;
}
