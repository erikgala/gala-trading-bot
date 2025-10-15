export interface TradeAmount {
  maxTrade: number;
  buyInput: number | null;
  sellOutput: number | null;
}

export interface TradeProfit {
  estimated: number;
  actual: number | null;
  percentage: number;
  effective: number;
}

export interface TradeBalance {
  hasFunds: boolean;
  currentBalance: number;
  shortfall: number;
}

export interface TradeTokenRef {
  symbol: string;
  tokenClass: string;
}

export interface Trade {
  executionId: string;
  strategy: 'direct' | 'triangular';
  status: string;
  startTime: string;
  endTime: string | null;
  entryToken: TradeTokenRef;
  exitToken: TradeTokenRef;
  amount: TradeAmount;
  profit: TradeProfit;
  balance: TradeBalance;
  error: string | null;
  environment: {
    mockMode: boolean;
  };
}

export interface ProfitSummary {
  totalProfit: number;
  realizedProfit: number;
  unrealizedProfit: number;
  averageProfitPerTrade: number;
  totalTrades: number;
  profitableTrades: number;
  lastUpdated: string;
}

export interface SocketInitPayload {
  trades: Trade[];
  summary: ProfitSummary;
}

export interface SocketUpdatePayload {
  trade: Trade;
  summary: ProfitSummary;
}

export interface PaginatedTradesResponse {
  trades: Trade[];
  page: number;
  pageSize: number;
  totalTrades: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export type SocketMessage =
  | { type: 'init'; payload: SocketInitPayload }
  | { type: 'trade'; payload: SocketUpdatePayload }
  | { type: 'summary'; payload: ProfitSummary }
  | { type: 'error'; payload: string };
