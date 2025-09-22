import {
  BalanceSnapshot,
  GSwapAPI,
  QuoteMap,
  SwapQuote,
  TokenInfo,
  TradingPair,
  buildQuoteCacheKey,
} from '../api/gswap';
import { config } from '../config';

const OPPORTUNITY_ID_PREFIX = 'simple-arb';

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

export interface ArbitrageStrategy {
  name: string;
  description: string;
  detectOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap?: QuoteMap
  ): Promise<ArbitrageOpportunity[]>;
  detectOpportunitiesForSwap?(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]>;
}

export type ArbitrageStrategyConstructor = new (balanceSnapshot: BalanceSnapshot) => ArbitrageStrategy;

function buildTokenInfoFallback(symbol: string, tokenClass: string): TokenInfo {
  return {
    symbol,
    name: symbol,
    decimals: 18,
    tokenClass,
    price: 0,
    priceChange24h: 0,
  };
}

function createOpportunityId(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${OPPORTUNITY_ID_PREFIX}-${Date.now()}-${randomSuffix}`;
}

function calculatePriceDiscrepancy(expectedPrice: number, currentPrice?: number): number | undefined {
  if (!currentPrice || currentPrice <= 0) {
    return undefined;
  }

  if (expectedPrice <= 0) {
    return undefined;
  }

  return Math.abs((expectedPrice - currentPrice) / currentPrice) * 100;
}

class SimpleArbitrageStrategy implements ArbitrageStrategy {
  name = 'Simple Single-Pair Arbitrage';
  description = 'Checks round-trip profitability within a single trading pair using fresh quotes.';

  constructor(private readonly balanceSnapshot: BalanceSnapshot) {}

  async detectOpportunities(pairs: TradingPair[], api: GSwapAPI): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    for (const pair of pairs) {
      const forward = await this.evaluateDirection(pair.tokenA, pair.tokenB, api);
      if (forward) {
        opportunities.push(forward);
      }

      const reverse = await this.evaluateDirection(pair.tokenB, pair.tokenA, api);
      if (reverse) {
        opportunities.push(reverse);
      }
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const inputClass = api.createTokenClassKey(swapData.tokenIn);
    const outputClass = api.createTokenClassKey(swapData.tokenOut);

    const [inputInfo, outputInfo] = await Promise.all([
      api.getTokenInfoByClassKey(inputClass),
      api.getTokenInfoByClassKey(outputClass),
    ]);

    const tokenInInfo = inputInfo ?? buildTokenInfoFallback(swapData.tokenIn.collection, inputClass);
    const tokenOutInfo = outputInfo ?? buildTokenInfoFallback(swapData.tokenOut.collection, outputClass);

    const opportunities: ArbitrageOpportunity[] = [];

    const forward = await this.evaluateDirection(tokenInInfo, tokenOutInfo, api, currentPrice);
    if (forward) {
      opportunities.push(forward);
    }

    const reverse = await this.evaluateDirection(tokenOutInfo, tokenInInfo, api, currentPrice);
    if (reverse) {
      opportunities.push(reverse);
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async evaluateDirection(
    inputToken: TokenInfo,
    outputToken: TokenInfo,
    api: GSwapAPI,
    currentPrice?: number
  ): Promise<ArbitrageOpportunity | null> {
    const funds = await api.checkTradingFunds(config.maxTradeAmount, inputToken.tokenClass, this.balanceSnapshot);

    if (!funds.hasFunds && funds.currentBalance <= 0) {
      return null;
    }

    const tradeAmount = Math.min(config.maxTradeAmount, Math.max(funds.currentBalance, 0));

    if (tradeAmount <= 0) {
      return null;
    }

    const buyQuote = await api.getQuote(inputToken.tokenClass, outputToken.tokenClass, tradeAmount);
    if (!buyQuote) {
      return null;
    }

    const sellQuote = await api.getQuote(outputToken.tokenClass, inputToken.tokenClass, buyQuote.outputAmount);
    if (!sellQuote) {
      return null;
    }

    const profit = sellQuote.outputAmount - tradeAmount;
    const profitPercentage = (profit / tradeAmount) * 100;

    if (profitPercentage < config.minProfitThreshold) {
      return null;
    }

    const buyPrice = buyQuote.outputAmount / buyQuote.inputAmount;
    const sellPrice = sellQuote.outputAmount / sellQuote.inputAmount;

    return {
      id: createOpportunityId(),
      tokenA: inputToken.symbol,
      tokenB: outputToken.symbol,
      tokenClassA: inputToken.tokenClass,
      tokenClassB: outputToken.tokenClass,
      buyPrice,
      sellPrice,
      profitPercentage,
      estimatedProfit: profit,
      maxTradeAmount: tradeAmount,
      buyQuote,
      sellQuote,
      hasFunds: funds.hasFunds || funds.currentBalance >= tradeAmount,
      currentBalance: funds.currentBalance,
      shortfall: funds.shortfall,
      timestamp: Date.now(),
      currentMarketPrice: currentPrice,
      priceDiscrepancy: calculatePriceDiscrepancy(buyPrice, currentPrice),
      confidence: profitPercentage,
    };
  }
}

export class ArbitrageDetector {
  private readonly strategyConstructors: ArbitrageStrategyConstructor[];

  constructor(strategyConstructors?: ArbitrageStrategyConstructor[]) {
    this.strategyConstructors = strategyConstructors ?? [SimpleArbitrageStrategy];
  }

  private instantiateStrategies(balanceSnapshot: BalanceSnapshot): ArbitrageStrategy[] {
    return this.strategyConstructors.map((Strategy) => new Strategy(balanceSnapshot));
  }

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const balanceSnapshot = await api.getBalanceSnapshot();
    const strategies = this.instantiateStrategies(balanceSnapshot);

    const opportunities: ArbitrageOpportunity[] = [];

    for (const strategy of strategies) {
      if (!strategy.detectOpportunitiesForSwap) {
        continue;
      }

      try {
        const results = await strategy.detectOpportunitiesForSwap(swapData, currentPrice, api);
        opportunities.push(...results);
      } catch (error) {
        console.error(`Error running ${strategy.name} (swap-focused):`, error);
      }
    }

    return this.removeDuplicateOpportunities(opportunities).sort(
      (a, b) => b.profitPercentage - a.profitPercentage
    );
  }

  async detectAllOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity[]> {
    const balanceSnapshot = await api.getBalanceSnapshot();
    const strategies = this.instantiateStrategies(balanceSnapshot);

    const opportunities: ArbitrageOpportunity[] = [];

    for (const strategy of strategies) {
      try {
        const results = await strategy.detectOpportunities(pairs, api, quoteMap);
        opportunities.push(...results);
      } catch (error) {
        console.error(`Error running ${strategy.name}:`, error);
      }
    }

    return this.removeDuplicateOpportunities(opportunities).sort(
      (a, b) => b.profitPercentage - a.profitPercentage
    );
  }

  private removeDuplicateOpportunities(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
    const seen = new Map<string, ArbitrageOpportunity>();

    for (const opportunity of opportunities) {
      const cacheKey = buildQuoteCacheKey(
        opportunity.tokenClassA,
        opportunity.tokenClassB,
        opportunity.maxTradeAmount
      );

      const existing = seen.get(cacheKey);

      if (!existing || opportunity.profitPercentage > existing.profitPercentage) {
        seen.set(cacheKey, opportunity);
      }
    }

    return Array.from(seen.values());
  }
}

export { SimpleArbitrageStrategy };
