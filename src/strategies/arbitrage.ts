import {
  BalanceSnapshot,
  GSwapAPI,
  QuoteMap,
  SwapQuote,
  TradingPair,
  buildQuoteCacheKey,
} from '../api/gswap';
import { config } from '../config';
import type { DexV3Operation } from '../streaming/types';
import type { TriangularArbitrageOpportunity } from './triangularArbitrage';
import { isSupportedPair } from '../config/tradingPairs';

const QUOTE_CACHE_TTL_MS = 30_000;

export type ArbitrageStrategyType = 'direct' | 'triangular';

export interface BaseArbitrageOpportunity {
  id: string;
  strategy: ArbitrageStrategyType;
  entryTokenClass: string;
  entryTokenSymbol: string;
  exitTokenClass: string;
  exitTokenSymbol: string;
  profitPercentage: number;
  estimatedProfit: number;
  maxTradeAmount: number;
  hasFunds: boolean;
  currentBalance: number;
  shortfall: number;
  timestamp: number;
  currentMarketPrice?: number;
  priceDiscrepancy?: number;
  confidence?: number;
}

interface SwapExtraction {
  swapData: SwapData;
  currentPrice: number;
}

function extractSwapTokens(operation: DexV3Operation) {
  const { dto } = operation;

  if (dto.zeroForOne) {
    return { tokenIn: dto.token0, tokenOut: dto.token1 };
  }

  return { tokenIn: dto.token1, tokenOut: dto.token0 };
}

function estimatePriceFromOperation(operation: DexV3Operation): number {
  const amountIn = parseFloat(operation.dto.amount);
  const amountOut = parseFloat(operation.dto.amountInMaximum);

  if (Number.isFinite(amountIn) && Number.isFinite(amountOut) && amountIn > 0 && amountOut > 0) {
    return amountOut / amountIn;
  }

  return 0;
}

function buildSwapExtraction(operation: DexV3Operation): SwapExtraction {
  const { tokenIn, tokenOut } = extractSwapTokens(operation);

  const swapData: SwapData = {
    tokenIn,
    tokenOut,
    amountIn: operation.dto.amount,
    amountInMaximum: operation.dto.amountInMaximum,
    fee: operation.dto.fee,
    sqrtPriceLimit: operation.dto.sqrtPriceLimit,
    recipient: operation.dto.recipient,
    signature: operation.dto.signature,
    uniqueKey: operation.dto.uniqueKey,
    method: operation.method,
    uniqueId: operation.uniqueId,
  };

  return {
    swapData,
    currentPrice: estimatePriceFromOperation(operation),
  };
}

async function getQuoteFromCacheOrApi(
  quoteMap: QuoteMap | undefined,
  api: GSwapAPI,
  inputTokenClass: string,
  outputTokenClass: string,
  inputAmount: number
): Promise<SwapQuote | null> {
  const cacheKey = buildQuoteCacheKey(inputTokenClass, outputTokenClass, inputAmount);

  if (quoteMap) {
    const cached = quoteMap.get(cacheKey);
    if (cached && Date.now() - cached.timestamp <= QUOTE_CACHE_TTL_MS) {
      return cached.quote;
    }
  }

  const liveQuote = await api.getQuote(inputTokenClass, outputTokenClass, inputAmount);

  if (liveQuote && quoteMap) {
    quoteMap.set(cacheKey, { quote: liveQuote, timestamp: Date.now() });
  }

  return liveQuote;
}

export interface DirectArbitrageOpportunity extends BaseArbitrageOpportunity {
  strategy: 'direct';
  tokenA: string;
  tokenB: string;
  tokenClassA: string;
  tokenClassB: string;
  buyPrice: number;
  sellPrice: number;
  /** Quote for swapping tokenClassA -> tokenClassB. */
  quoteAToB: SwapQuote;
  /** Quote for swapping tokenClassB -> tokenClassA. */
  quoteBToA: SwapQuote;
}

export type ArbitrageOpportunity = DirectArbitrageOpportunity | TriangularArbitrageOpportunity;

export interface SwapData {
  tokenIn: {
    collection: string;
    category: string;
    type: string;
    additionalKey: string;
  };
  tokenOut: {
    collection: string;
    category: string;
    type: string;
    additionalKey: string;
  };
  amountIn: string;
  amountInMaximum: string;
  fee: number;
  sqrtPriceLimit: string;
  recipient: string;
  signature: string;
  uniqueKey: string;
  method: string;
  uniqueId: string;
}

interface DirectArbitrageParams {
  tokenA: string;
  tokenB: string;
  tokenClassA: string;
  tokenClassB: string;
  api: GSwapAPI;
  balanceSnapshot: BalanceSnapshot;
  quoteMap?: QuoteMap;
  currentPrice?: number;
}

export class ArbitrageDetector {
  async evaluateSwapOperation(operation: DexV3Operation, api: GSwapAPI): Promise<ArbitrageOpportunity | null> {
    const { swapData, currentPrice } = buildSwapExtraction(operation);
    const opportunities = await this.detectOpportunitiesForSwap(swapData, currentPrice, api);
    return opportunities[0] ?? null;
  }

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
    const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);

    if (!isSupportedPair(tokenInClassKey, tokenOutClassKey)) {
      return [];
    }

    if(swapData.recipient === config.walletAddress) {
      return [];
    }

    if (
      !api.isTokenAvailableByClassKey(tokenInClassKey) ||
      !api.isTokenAvailableByClassKey(tokenOutClassKey)
    ) {
      return [];
    }

    const balanceSnapshot = await api.getBalanceSnapshot();
    const opportunities: ArbitrageOpportunity[] = [];

    const forwardOpportunity = await this.evaluateDirectArbitrage({
      tokenA: swapData.tokenIn.collection,
      tokenB: swapData.tokenOut.collection,
      tokenClassA: tokenInClassKey,
      tokenClassB: tokenOutClassKey,
      api,
      balanceSnapshot,
      currentPrice,
    });

    if (forwardOpportunity) {
      opportunities.push(forwardOpportunity);
    }

    const reverseOpportunity = await this.evaluateDirectArbitrage({
      tokenA: swapData.tokenOut.collection,
      tokenB: swapData.tokenIn.collection,
      tokenClassA: tokenOutClassKey,
      tokenClassB: tokenInClassKey,
      api,
      balanceSnapshot,
      currentPrice,
    });

    if (reverseOpportunity) {
      opportunities.push(reverseOpportunity);
    }

    if (opportunities.length <= 1) {
      return opportunities;
    }

    const primaryEntryClass = tokenInClassKey;
    return opportunities.sort((a, b) => {
      const profitDelta = (b.profitPercentage ?? 0) - (a.profitPercentage ?? 0);
      if (Number.isFinite(profitDelta) && profitDelta !== 0) {
        return profitDelta;
      }

      const aPrimary = a.entryTokenClass === primaryEntryClass ? 1 : 0;
      const bPrimary = b.entryTokenClass === primaryEntryClass ? 1 : 0;
      if (aPrimary !== bPrimary) {
        return bPrimary - aPrimary;
      }

      return a.entryTokenClass.localeCompare(b.entryTokenClass);
    });
  }

  async detectAllOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity[]> {
    if (pairs.length === 0) {
      return [];
    }

    const balanceSnapshot = await api.getBalanceSnapshot();
    const opportunities: ArbitrageOpportunity[] = [];

    for (const pair of pairs) {
      if (!isSupportedPair(pair.tokenClassA, pair.tokenClassB)) {
        continue;
      }

      const forwardOpportunity = await this.evaluateDirectArbitrage({
        tokenA: pair.tokenA.symbol,
        tokenB: pair.tokenB.symbol,
        tokenClassA: pair.tokenClassA,
        tokenClassB: pair.tokenClassB,
        api,
        balanceSnapshot,
        quoteMap,
      });

      if (forwardOpportunity) {
        opportunities.push(forwardOpportunity);
      }

      const reverseOpportunity = await this.evaluateDirectArbitrage({
        tokenA: pair.tokenB.symbol,
        tokenB: pair.tokenA.symbol,
        tokenClassA: pair.tokenClassB,
        tokenClassB: pair.tokenClassA,
        api,
        balanceSnapshot,
        quoteMap,
      });

      if (reverseOpportunity) {
        opportunities.push(reverseOpportunity);
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async evaluateDirectArbitrage({
    tokenA,
    tokenB,
    tokenClassA,
    tokenClassB,
    api,
    balanceSnapshot,
    quoteMap,
    currentPrice,
  }: DirectArbitrageParams): Promise<ArbitrageOpportunity | null> {
    const maxTradeAmount = config.maxTradeAmount;
    const fundsCheck = await api.checkTradingFunds(maxTradeAmount, tokenClassA, balanceSnapshot);
    const amountToTrade = Math.min(maxTradeAmount, fundsCheck.currentBalance * 0.8);

    const hasSufficientFunds = amountToTrade > 0 && amountToTrade <= fundsCheck.currentBalance;
    const shortfall = hasSufficientFunds ? 0 : Math.max(0, amountToTrade - fundsCheck.currentBalance);

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      return null;
    }

    const quoteAB = await getQuoteFromCacheOrApi(
      quoteMap,
      api,
      tokenClassA,
      tokenClassB,
      amountToTrade
    );

    if (!quoteAB || !Number.isFinite(quoteAB.outputAmount) || quoteAB.outputAmount <= 0) {
      return null;
    }

    const quoteBA = await getQuoteFromCacheOrApi(
      quoteMap,
      api,
      tokenClassB,
      tokenClassA,
      quoteAB.outputAmount
    );

    if (!quoteBA || !Number.isFinite(quoteBA.outputAmount) || quoteBA.outputAmount <= 0) {
      return null;
    }

    const profitAmount = quoteBA.outputAmount - amountToTrade;

    if (!Number.isFinite(profitAmount) || profitAmount <= 0) {
      return null;
    }

    const profitPercentage = (profitAmount / amountToTrade) * 100;

    if (!Number.isFinite(profitPercentage) || profitPercentage < config.minProfitThreshold) {
      return null;
    }

    const buyPrice = quoteAB.inputAmount / quoteAB.outputAmount;
    const sellPrice = quoteBA.outputAmount / quoteBA.inputAmount;

    if (!Number.isFinite(sellPrice) || !Number.isFinite(buyPrice)) {
      return null;
    }

    const estimatedProfit = profitAmount;

    const marketPrice = typeof currentPrice === 'number' && currentPrice > 0 ? currentPrice : sellPrice;
    const priceDiscrepancy = marketPrice > 0 ? (Math.abs(marketPrice - sellPrice) / marketPrice) * 100 : 0;

    return {
      id: `direct-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      strategy: 'direct',
      entryTokenClass: tokenClassA,
      entryTokenSymbol: tokenA,
      exitTokenClass: tokenClassA,
      exitTokenSymbol: tokenA,
      tokenA,
      tokenB,
      tokenClassA,
      tokenClassB,
      buyPrice,
      sellPrice,
      profitPercentage,
      estimatedProfit,
      maxTradeAmount: amountToTrade,
      quoteAToB: quoteAB,
      quoteBToA: quoteBA,
      hasFunds: hasSufficientFunds,
      currentBalance: fundsCheck.currentBalance,
      shortfall,
      timestamp: Date.now(),
      currentMarketPrice: marketPrice,
      priceDiscrepancy,
      confidence: profitPercentage,
    };
  }
}
