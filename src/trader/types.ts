import type { SwapResult } from '../api/gswap';
import type { ArbitrageOpportunity } from '../strategies/arbitrage';

export type TradeStatus =
  | 'pending'
  | 'buying'
  | 'selling'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TradeExecution {
  id: string;
  opportunity: ArbitrageOpportunity;
  buySwap?: SwapResult;
  sellSwap?: SwapResult;
  intermediateSwaps?: SwapResult[];
  status: TradeStatus;
  startTime: number;
  endTime?: number;
  actualProfit?: number;
  error?: string;
}
