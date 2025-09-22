import {
  BalanceSnapshot,
  GSwapAPI,
  QuoteMap,
  SwapQuote,
  TradingPair,
  buildQuoteCacheKey,
} from '../api/gswap';
import { config } from '../config';
import type { TokenInfo } from '../api/types';
import type { BaseArbitrageOpportunity } from './arbitrage';

const QUOTE_CACHE_TTL_MS = 30_000;
const TEST_TRADE_AMOUNT = 1;
const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';

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
    const galaToken = tokensByClass.get(GALA_TOKEN_CLASS);

    if (!galaToken) {
      return [];
    }

    const otherTokens = Array.from(tokensByClass.values()).filter(
      token => token.tokenClass !== GALA_TOKEN_CLASS,
    );

    if (otherTokens.length < 2) {
      return [];
    }

    const provider = new CachedQuoteProvider(api, quoteMap);
    const balanceSnapshot = await api.getBalanceSnapshot();
    const opportunities: TriangularArbitrageOpportunity[] = [];

    for (const firstToken of otherTokens) {
      const firstQuote = await provider.getQuote(
        galaToken.tokenClass,
        firstToken.tokenClass,
        TEST_TRADE_AMOUNT,
      );

      if (!isValidQuote(firstQuote)) {
        continue;
      }

      for (const secondToken of otherTokens) {
        if (secondToken.tokenClass === firstToken.tokenClass) {
          continue;
        }

        const secondQuote = await provider.getQuote(
          firstToken.tokenClass,
          secondToken.tokenClass,
          firstQuote.outputAmount,
        );

        if (!isValidQuote(secondQuote)) {
          continue;
        }

        const thirdQuote = await provider.getQuote(
          secondToken.tokenClass,
          galaToken.tokenClass,
          secondQuote.outputAmount,
        );

        if (!isValidQuote(thirdQuote)) {
          continue;
        }

        const opportunity = await this.evaluateOpportunity({
          api,
          balanceSnapshot,
          galaToken,
          firstToken,
          secondToken,
          firstQuote,
          secondQuote,
          thirdQuote,
        });

        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async evaluateOpportunity(params: {
    api: GSwapAPI;
    balanceSnapshot: BalanceSnapshot;
    galaToken: TokenInfo;
    firstToken: TokenInfo;
    secondToken: TokenInfo;
    firstQuote: SwapQuote;
    secondQuote: SwapQuote;
    thirdQuote: SwapQuote;
  }): Promise<TriangularArbitrageOpportunity | null> {
    const {
      api,
      balanceSnapshot,
      galaToken,
      firstToken,
      secondToken,
      firstQuote,
      secondQuote,
      thirdQuote,
    } = params;

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
      galaToken.tokenClass,
      balanceSnapshot,
    );

    const amountToTrade = Math.min(maxTradeAmount, fundsCheck.currentBalance * 0.8);

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      return null;
    }

    const unitProfit = profitAmount / startingAmount;
    const estimatedProfit = unitProfit * amountToTrade;

    return {
      id: `tri-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      strategy: 'triangular',
      entryTokenClass: galaToken.tokenClass,
      entryTokenSymbol: galaToken.symbol,
      exitTokenClass: galaToken.tokenClass,
      exitTokenSymbol: galaToken.symbol,
      profitPercentage,
      estimatedProfit,
      maxTradeAmount: amountToTrade,
      hasFunds: fundsCheck.hasFunds,
      currentBalance: fundsCheck.currentBalance,
      shortfall: fundsCheck.shortfall,
      timestamp: Date.now(),
      confidence: profitPercentage,
      path: [
        {
          fromSymbol: galaToken.symbol,
          fromTokenClass: galaToken.tokenClass,
          toSymbol: firstToken.symbol,
          toTokenClass: firstToken.tokenClass,
          quote: firstQuote,
          inputAmount: firstQuote.inputAmount,
          outputAmount: firstQuote.outputAmount,
        },
        {
          fromSymbol: firstToken.symbol,
          fromTokenClass: firstToken.tokenClass,
          toSymbol: secondToken.symbol,
          toTokenClass: secondToken.tokenClass,
          quote: secondQuote,
          inputAmount: secondQuote.inputAmount,
          outputAmount: secondQuote.outputAmount,
        },
        {
          fromSymbol: secondToken.symbol,
          fromTokenClass: secondToken.tokenClass,
          toSymbol: galaToken.symbol,
          toTokenClass: galaToken.tokenClass,
          quote: thirdQuote,
          inputAmount: thirdQuote.inputAmount,
          outputAmount: thirdQuote.outputAmount,
        },
      ],
      referenceInputAmount: startingAmount,
      referenceOutputAmount: finalAmount,
    };
  }
}
