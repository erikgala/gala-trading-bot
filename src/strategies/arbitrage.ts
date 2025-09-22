import {
  BalanceSnapshot,
  GSwapAPI,
  QuoteMap,
  SwapQuote,
  TradingPair,
  buildQuoteCacheKey,
} from '../api/gswap';
import { config } from '../config';

const QUOTE_CACHE_TTL_MS = 30_000;
const TEST_TRADE_AMOUNT = 1;
const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';

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

export interface ArbitrageOpportunity {
  id: string;
  tokenA: string;
  tokenB: string;
  tokenClassA: string;
  tokenClassB: string;
  buyPrice: number;
  sellPrice: number;
  profitPercentage: number;
  estimatedProfit: number;
  maxTradeAmount: number;
  buyQuote: SwapQuote;
  sellQuote: SwapQuote;
  hasFunds: boolean;
  currentBalance: number;
  shortfall: number;
  timestamp: number;
  currentMarketPrice?: number;
  priceDiscrepancy?: number;
  confidence?: number;
}

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
  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
    const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);

    if (!this.involvesGala(tokenInClassKey, tokenOutClassKey)) {
      return [];
    }

    const balanceSnapshot = await api.getBalanceSnapshot();
    const opportunity = await this.evaluateDirectArbitrage({
      tokenA: swapData.tokenIn.collection,
      tokenB: swapData.tokenOut.collection,
      tokenClassA: tokenInClassKey,
      tokenClassB: tokenOutClassKey,
      api,
      balanceSnapshot,
      currentPrice,
    });

    return opportunity ? [opportunity] : [];
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
      if (!this.involvesGala(pair.tokenClassA, pair.tokenClassB)) {
        continue;
      }

      const opportunity = await this.evaluateDirectArbitrage({
        tokenA: pair.tokenA.symbol,
        tokenB: pair.tokenB.symbol,
        tokenClassA: pair.tokenClassA,
        tokenClassB: pair.tokenClassB,
        api,
        balanceSnapshot,
        quoteMap,
      });

      if (opportunity) {
        opportunities.push(opportunity);
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private involvesGala(tokenClassA: string, tokenClassB: string): boolean {
    return tokenClassA === GALA_TOKEN_CLASS || tokenClassB === GALA_TOKEN_CLASS;
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
    const quoteAB = await getQuoteFromCacheOrApi(
      quoteMap,
      api,
      tokenClassA,
      tokenClassB,
      TEST_TRADE_AMOUNT
    );
    const quoteBA = await getQuoteFromCacheOrApi(
      quoteMap,
      api,
      tokenClassB,
      tokenClassA,
      TEST_TRADE_AMOUNT
    );

    if (!quoteAB || !quoteBA) {
      return null;
    }

    const rateAB = quoteAB.outputAmount / quoteAB.inputAmount;
    const rateBA = quoteBA.outputAmount / quoteBA.inputAmount;

    if (!isFinite(rateAB) || !isFinite(rateBA) || rateAB <= 0 || rateBA <= 0) {
      return null;
    }

    const buyPrice = 1 / rateBA;
    const sellPrice = rateAB;
    const spread = sellPrice - buyPrice;

    if (!isFinite(spread) || spread <= 0) {
      return null;
    }

    const profitPercentage = (spread / buyPrice) * 100;

    if (!isFinite(profitPercentage) || profitPercentage < config.minProfitThreshold) {
      return null;
    }

    const maxTradeAmount = config.maxTradeAmount;
    const fundsCheck = await api.checkTradingFunds(maxTradeAmount, tokenClassA, balanceSnapshot);
    const estimatedProfit = spread * maxTradeAmount;

    const marketPrice = typeof currentPrice === 'number' && currentPrice > 0 ? currentPrice : sellPrice;
    const priceDiscrepancy = marketPrice > 0 ? (Math.abs(marketPrice - sellPrice) / marketPrice) * 100 : 0;

    return {
      id: `direct-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      tokenA,
      tokenB,
      tokenClassA,
      tokenClassB,
      buyPrice,
      sellPrice,
      profitPercentage,
      estimatedProfit,
      maxTradeAmount,
      buyQuote: quoteBA,
      sellQuote: quoteAB,
      hasFunds: fundsCheck.hasFunds,
      currentBalance: fundsCheck.currentBalance,
      shortfall: fundsCheck.shortfall,
      timestamp: Date.now(),
      currentMarketPrice: marketPrice,
      priceDiscrepancy,
      confidence: profitPercentage,
    };
  }
}
