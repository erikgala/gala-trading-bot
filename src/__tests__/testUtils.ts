import { ArbitrageOpportunity, SwapData } from '../strategies/arbitrage';
import { TradingPair, TokenInfo, SwapQuote, SwapResult } from '../api/gswap';

export const createMockTokenInfo = (symbol: string, tokenClass: string): TokenInfo => ({
  symbol,
  name: `Mock ${symbol}`,
  decimals: symbol === 'GALA' ? 18 : 6,
  tokenClass,
  price: symbol === 'GALA' ? 0.04 : 1.0,
  priceChange24h: 0.01
});

export const createMockTradingPair = (tokenA: string, tokenB: string): TradingPair => ({
  tokenA: createMockTokenInfo(tokenA, `${tokenA}|Unit|none|none`),
  tokenB: createMockTokenInfo(tokenB, `${tokenB}|Unit|none|none`),
  tokenClassA: `${tokenA}|Unit|none|none`,
  tokenClassB: `${tokenB}|Unit|none|none`
});

export const createMockSwapQuote = (
  inputAmount: number,
  outputAmount: number,
  inputToken = 'GALA|Unit|none|none',
  outputToken = 'GUSDC|Unit|none|none'
): SwapQuote => ({
  inputToken,
  outputToken,
  inputAmount,
  outputAmount,
  priceImpact: 0.1,
  feeTier: 3000,
  route: [inputToken, outputToken]
});

export const createMockSwapResult = (
  transactionHash: string,
  overrides: Partial<SwapResult> = {}
): SwapResult => ({
  transactionHash,
  inputAmount: 1000,
  outputAmount: 25000,
  actualPrice: 0.04,
  gasUsed: 100000,
  timestamp: Date.now(),
  ...overrides
});

export const createMockArbitrageOpportunity = (): ArbitrageOpportunity => ({
  id: 'test-opportunity',
  tokenA: 'GALA',
  tokenB: 'GUSDC',
  tokenClassA: 'GALA|Unit|none|none',
  tokenClassB: 'GUSDC|Unit|none|none',
  buyPrice: 0.039,
  sellPrice: 0.041,
  profitPercentage: 5.13,
  estimatedProfit: 51.3,
  maxTradeAmount: 1000,
  quoteAToB: createMockSwapQuote(1000, 25641, 'GALA|Unit|none|none', 'GUSDC|Unit|none|none'),
  quoteBToA: createMockSwapQuote(25641, 1051.3, 'GUSDC|Unit|none|none', 'GALA|Unit|none|none'),
  hasFunds: true,
  currentBalance: 10000,
  shortfall: 0,
  timestamp: Date.now()
});

export const createMockSwapData = (): SwapData => ({
  tokenIn: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
  tokenOut: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
  amountIn: '1000',
  amountInMaximum: '1000',
  fee: 3000,
  sqrtPriceLimit: '1000000000000000000',
  recipient: '0x123',
  signature: '0xabc',
  uniqueKey: 'test-key',
  method: 'swap',
  uniqueId: 'test-id'
});
