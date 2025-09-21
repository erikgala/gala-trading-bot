export interface GalaSwapToken {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
  decimals: string;
  quantity: string;
  compositeKey: string;
  image: string;
  name: string;
  symbol: string;
  description: string;
  verify: boolean;
}

export interface GalaSwapTokenListResponse {
  status: number;
  error: boolean;
  message: string;
  data: {
    token: GalaSwapToken[];
    count: number;
  };
}

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  tokenClass: string; // Format: "SYMBOL|Unit|none|none"
  price: number;
  priceChange24h: number;
}

export interface TradingPair {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  tokenClassA: string;
  tokenClassB: string;
}

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  feeTier: number;
  route: string[];
}

export interface QuoteCacheEntry {
  quote: SwapQuote;
  timestamp: number;
}

export type QuoteMap = Map<string, QuoteCacheEntry>;

export interface UserAssetToken {
  symbol: string;
  quantity: string;
  collection?: string;
  category?: string;
  type?: string;
  additionalKey?: string;
}

export interface UserAssetsResponse {
  tokens?: UserAssetToken[];
}

export interface SwapResult {
  transactionHash: string;
  inputAmount: number;
  outputAmount: number;
  actualPrice: number;
  gasUsed: number;
  timestamp: number;
}
