/**
 * Placeholder types for Kafka block data
 * These will be updated once we see the actual block data structure
 */

export interface BlockData {
  // Placeholder - will be updated with real schema
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  transactions: TransactionData[];
  // Additional fields will be added based on real data
}

export interface TransactionData {
  // Placeholder - will be updated with real schema
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: number;
  gasPrice: string;
  logs: LogData[];
  // Additional fields will be added based on real data
}

export interface LogData {
  // Placeholder - will be updated with real schema
  address: string;
  topics: string[];
  data: string;
  // Additional fields will be added based on real data
}

export interface SwapEvent {
  // Placeholder - will be updated with real schema
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  fee: string;
  user: string;
  // Additional fields will be added based on real data
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  topics: {
    blocks: string;
    swaps: string;
  };
  // Additional Kafka configuration
  ssl?: boolean;
  sasl?: {
    mechanism: string;
    username: string;
    password: string;
  };
}

export interface EventProcessor {
  processBlock(blockData: BlockData): Promise<void>;
  processSwap(swapEvent: SwapEvent): Promise<void>;
  processTransaction(txData: TransactionData): Promise<void>;
}
