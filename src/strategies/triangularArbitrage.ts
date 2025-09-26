import {
  BalanceSnapshot,
  GSwapAPI,
  QuoteMap,
  SwapQuote,
  TradingPair,
} from '../api/gswap';
import { buildQuoteCacheKey } from '../api/quotes';
import { config } from '../config';
import { isSupportedPair } from '../config/tradingPairs';
import type { TokenInfo } from '../api/types';
import type { BaseArbitrageOpportunity } from './arbitrage';

const QUOTE_CACHE_TTL_MS = 30_000;
const TEST_TRADE_AMOUNT = 1;

interface CachedQuoteEntry {
  quote: SwapQuote;
  timestamp: number;
}

class CachedQuoteProvider {
  private readonly localCache: Map<string, CachedQuoteEntry> = new Map();

  constructor(private readonly api: GSwapAPI, private readonly baseQuoteMap?: QuoteMap) {}

  async getQuote(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
  ): Promise<SwapQuote | null> {
    if (!isSupportedPair(inputTokenClass, outputTokenClass)) {
      return null;
    }

    const cacheKey = buildQuoteCacheKey(inputTokenClass, outputTokenClass, inputAmount);
    const now = Date.now();

    const cachedFromBase = this.baseQuoteMap?.get(cacheKey);
    if (cachedFromBase && now - cachedFromBase.timestamp <= QUOTE_CACHE_TTL_MS) {
      return cachedFromBase.quote;
    }

    const cachedLocal = this.localCache.get(cacheKey);
    if (cachedLocal && now - cachedLocal.timestamp <= QUOTE_CACHE_TTL_MS) {
      return cachedLocal.quote;
    }

    const quote = await this.api.getQuote(inputTokenClass, outputTokenClass, inputAmount);
    if (quote) {
      this.localCache.set(cacheKey, { quote, timestamp: now });
    }

    return quote;
  }
}

export interface TriangularArbitrageLeg {
  fromSymbol: string;
  fromTokenClass: string;
  toSymbol: string;
  toTokenClass: string;
  quote: SwapQuote;
  inputAmount: number;
  outputAmount: number;
}

export interface TriangularArbitrageOpportunity extends BaseArbitrageOpportunity {
  strategy: 'triangular';
  path: TriangularArbitrageLeg[];
  referenceInputAmount: number;
  referenceOutputAmount: number;
}

function isValidQuote(quote: SwapQuote | null): quote is SwapQuote {
  return (
    !!quote &&
    Number.isFinite(quote.inputAmount) &&
    Number.isFinite(quote.outputAmount) &&
    quote.inputAmount > 0 &&
    quote.outputAmount > 0
  );
}

function extractTokensFromPairs(pairs: TradingPair[]): Map<string, TokenInfo> {
  const map = new Map<string, TokenInfo>();

  for (const pair of pairs) {
    map.set(pair.tokenA.tokenClass, pair.tokenA);
    map.set(pair.tokenB.tokenClass, pair.tokenB);
  }

  return map;
}

const buildPairKey = (tokenClassA: string, tokenClassB: string): string =>
  [tokenClassA, tokenClassB].sort().join('::');

export class TriangularArbitrageDetector {
  async detectAllOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap,
  ): Promise<TriangularArbitrageOpportunity[]> {
    if (pairs.length === 0) {
      return [];
    }

    const tokensByClass = extractTokensFromPairs(pairs);
    const tokenList = Array.from(tokensByClass.values());

    if (tokenList.length < 3) {
      return [];
    }

    const provider = new CachedQuoteProvider(api, quoteMap);
    const balanceSnapshot = await api.getBalanceSnapshot();
    const opportunities: TriangularArbitrageOpportunity[] = [];
    const pairAvailability = new Set<string>();
    const evaluatedCycles = new Set<string>();

    for (const pair of pairs) {
      pairAvailability.add(buildPairKey(pair.tokenClassA, pair.tokenClassB));
    }

    const hasPair = (tokenClassA: string, tokenClassB: string): boolean =>
      isSupportedPair(tokenClassA, tokenClassB) && pairAvailability.has(buildPairKey(tokenClassA, tokenClassB));

    for (let i = 0; i < tokenList.length - 2; i++) {
      const tokenA = tokenList[i];

      for (let j = i + 1; j < tokenList.length - 1; j++) {
        const tokenB = tokenList[j];

        if (!hasPair(tokenA.tokenClass, tokenB.tokenClass)) {
          continue;
        }

        for (let k = j + 1; k < tokenList.length; k++) {
          const tokenC = tokenList[k];

          if (
            !hasPair(tokenB.tokenClass, tokenC.tokenClass) ||
            !hasPair(tokenC.tokenClass, tokenA.tokenClass)
          ) {
            continue;
          }

          const permutations: Array<[TokenInfo, TokenInfo, TokenInfo]> = [
            [tokenA, tokenB, tokenC],
            [tokenB, tokenC, tokenA],
            [tokenC, tokenA, tokenB],
          ];

          for (const [entryToken, middleToken, lastToken] of permutations) {
            const primaryKey = `${entryToken.tokenClass}->${middleToken.tokenClass}->${lastToken.tokenClass}`;
            if (!evaluatedCycles.has(primaryKey)) {
              evaluatedCycles.add(primaryKey);
              const opportunity = await this.evaluateOpportunity({
                api,
                balanceSnapshot,
                provider,
                firstToken: entryToken,
                secondToken: middleToken,
                thirdToken: lastToken,
                pairAvailability,
              });

              if (opportunity) {
                opportunities.push(opportunity);
              }
            }

            const reverseKey = `${entryToken.tokenClass}->${lastToken.tokenClass}->${middleToken.tokenClass}`;
            if (!evaluatedCycles.has(reverseKey)) {
              evaluatedCycles.add(reverseKey);
              const reverseOpportunity = await this.evaluateOpportunity({
                api,
                balanceSnapshot,
                provider,
                firstToken: entryToken,
                secondToken: lastToken,
                thirdToken: middleToken,
                pairAvailability,
              });

              if (reverseOpportunity) {
                opportunities.push(reverseOpportunity);
              }
            }
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async evaluateOpportunity(params: {
    api: GSwapAPI;
    balanceSnapshot: BalanceSnapshot;
    provider: CachedQuoteProvider;
    firstToken: TokenInfo;
    secondToken: TokenInfo;
    thirdToken: TokenInfo;
    pairAvailability: Set<string>;
  }): Promise<TriangularArbitrageOpportunity | null> {
    const {
      api,
      balanceSnapshot,
      provider,
      firstToken,
      secondToken,
      thirdToken,
      pairAvailability,
    } = params;

    const firstSecondKey = buildPairKey(firstToken.tokenClass, secondToken.tokenClass);
    const secondThirdKey = buildPairKey(secondToken.tokenClass, thirdToken.tokenClass);
    const thirdFirstKey = buildPairKey(thirdToken.tokenClass, firstToken.tokenClass);

    if (
      !isSupportedPair(firstToken.tokenClass, secondToken.tokenClass) ||
      !isSupportedPair(secondToken.tokenClass, thirdToken.tokenClass) ||
      !isSupportedPair(thirdToken.tokenClass, firstToken.tokenClass) ||
      !pairAvailability.has(firstSecondKey) ||
      !pairAvailability.has(secondThirdKey) ||
      !pairAvailability.has(thirdFirstKey)
    ) {
      return null;
    }

    const firstQuote = await provider.getQuote(
      firstToken.tokenClass,
      secondToken.tokenClass,
      TEST_TRADE_AMOUNT,
    );

    if (!isValidQuote(firstQuote)) {
      return null;
    }

    const secondQuote = await provider.getQuote(
      secondToken.tokenClass,
      thirdToken.tokenClass,
      firstQuote.outputAmount,
    );

    if (!isValidQuote(secondQuote)) {
      return null;
    }

    const thirdQuote = await provider.getQuote(
      thirdToken.tokenClass,
      firstToken.tokenClass,
      secondQuote.outputAmount,
    );

    if (!isValidQuote(thirdQuote)) {
      return null;
    }

    const startingAmount = firstQuote.inputAmount;
    const finalAmount = thirdQuote.outputAmount;
    const profitAmount = finalAmount - startingAmount;

    if (!Number.isFinite(profitAmount) || profitAmount <= 0) {
      return null;
    }

    const profitPercentage = (profitAmount / startingAmount) * 100;

    if (!Number.isFinite(profitPercentage) || profitPercentage < config.minProfitThreshold) {
      return null;
    }

    const maxTradeAmount = config.maxTradeAmount;
    const fundsCheck = await api.checkTradingFunds(
      maxTradeAmount,
      firstToken.tokenClass,
      balanceSnapshot,
    );

    const amountToTrade = Math.min(maxTradeAmount, fundsCheck.currentBalance * 0.8);

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      return null;
    }

    const tradeFirstQuote = await provider.getQuote(firstToken.tokenClass, secondToken.tokenClass, amountToTrade);

    if (!isValidQuote(tradeFirstQuote)) {
      return null;
    }

    const tradeSecondQuote = await provider.getQuote(
      secondToken.tokenClass,
      thirdToken.tokenClass,
      tradeFirstQuote.outputAmount,
    );

    if (!isValidQuote(tradeSecondQuote)) {
      return null;
    }

    const tradeThirdQuote = await provider.getQuote(
      thirdToken.tokenClass,
      firstToken.tokenClass,
      tradeSecondQuote.outputAmount,
    );

    if (!isValidQuote(tradeThirdQuote)) {
      return null;
    }

    const finalTradeAmount = tradeThirdQuote.outputAmount;
    const tradeProfitAmount = finalTradeAmount - amountToTrade;

    if (!Number.isFinite(tradeProfitAmount) || tradeProfitAmount <= 0) {
      return null;
    }

    const tradeProfitPercentage = (tradeProfitAmount / amountToTrade) * 100;

    if (!Number.isFinite(tradeProfitPercentage) || tradeProfitPercentage < config.minProfitThreshold) {
      return null;
    }

    // Calculate market price and price discrepancy for triangular arbitrage
    const buyPrice = tradeFirstQuote.inputAmount / tradeFirstQuote.outputAmount;
    const sellPrice = tradeThirdQuote.outputAmount / tradeThirdQuote.inputAmount;
    
    if (!Number.isFinite(sellPrice) || !Number.isFinite(buyPrice)) {
      return null;
    }

    // For triangular arbitrage, use the final sell price as market price
    const currentMarketPrice = sellPrice;
    const priceDiscrepancy = 0; // Triangular arbitrage doesn't have a direct market price comparison

    return {
      id: `tri-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      strategy: 'triangular',
      entryTokenClass: firstToken.tokenClass,
      entryTokenSymbol: firstToken.symbol,
      exitTokenClass: firstToken.tokenClass,
      exitTokenSymbol: firstToken.symbol,
      profitPercentage: tradeProfitPercentage,
      estimatedProfit: tradeProfitAmount,
      maxTradeAmount: amountToTrade,
      hasFunds: fundsCheck.hasFunds,
      currentBalance: fundsCheck.currentBalance,
      shortfall: fundsCheck.shortfall,
      timestamp: Date.now(),
      confidence: tradeProfitPercentage,
      currentMarketPrice,
      priceDiscrepancy,
      path: [
        {
          fromSymbol: firstToken.symbol,
          fromTokenClass: firstToken.tokenClass,
          toSymbol: secondToken.symbol,
          toTokenClass: secondToken.tokenClass,
          quote: tradeFirstQuote,
          inputAmount: tradeFirstQuote.inputAmount,
          outputAmount: tradeFirstQuote.outputAmount,
        },
        {
          fromSymbol: secondToken.symbol,
          fromTokenClass: secondToken.tokenClass,
          toSymbol: thirdToken.symbol,
          toTokenClass: thirdToken.tokenClass,
          quote: tradeSecondQuote,
          inputAmount: tradeSecondQuote.inputAmount,
          outputAmount: tradeSecondQuote.outputAmount,
        },
        {
          fromSymbol: thirdToken.symbol,
          fromTokenClass: thirdToken.tokenClass,
          toSymbol: firstToken.symbol,
          toTokenClass: firstToken.tokenClass,
          quote: tradeThirdQuote,
          inputAmount: tradeThirdQuote.inputAmount,
          outputAmount: tradeThirdQuote.outputAmount,
        },
      ],
      referenceInputAmount: amountToTrade,
      referenceOutputAmount: finalTradeAmount,
    };
  }
}
