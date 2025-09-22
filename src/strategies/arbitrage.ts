import { GSwapAPI, TradingPair, SwapQuote, TokenInfo, QuoteMap, buildQuoteCacheKey, BalanceSnapshot } from '../api/gswap';
import { config } from '../config';

const QUOTE_CACHE_TTL_MS = 30_000;

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
    const now = Date.now();

    if (cached && now - cached.timestamp <= QUOTE_CACHE_TTL_MS && cached.quote.inputAmount === inputAmount) {
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
  // Enhanced properties for real-time analysis
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
  detectOpportunitiesForSwap(swapData: SwapData, currentPrice: number, api: GSwapAPI): Promise<ArbitrageOpportunity[]>;
  detectOpportunities?(pairs: TradingPair[], api: GSwapAPI, quoteMap: QuoteMap): Promise<ArbitrageOpportunity[]>;
}

export type ArbitrageStrategyConstructor = new (balanceSnapshot: BalanceSnapshot) => ArbitrageStrategy;

export class CrossPairArbitrageStrategy implements ArbitrageStrategy {
  name = 'Cross-Pair Arbitrage';
  description = 'Detects arbitrage opportunities between different trading pairs for the same token';

  constructor(private readonly balanceSnapshot: BalanceSnapshot) {}

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Get token class keys for the swap
    const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
    const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);

    
    // Only analyze if GALA is involved
    const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';
    if (tokenInClassKey !== GALA_TOKEN_CLASS && tokenOutClassKey !== GALA_TOKEN_CLASS) {
      return opportunities;
    }
    
    // Get all available tokens to find related pairs
    const availableTokens = await api.getAvailableTokens();
    const galaToken = availableTokens.find(t => t.tokenClass === GALA_TOKEN_CLASS);
    
    if (!galaToken) {
      return opportunities;
    }
    
    // Find tokens that could form triangular arbitrage opportunities
    const relatedTokens = this.findRelatedTokensForArbitrage(swapData, availableTokens, api);
    
    // Analyze triangular arbitrage opportunities
    for (const relatedToken of relatedTokens) {
      const opportunity = await this.analyzeTriangularArbitrage(
        swapData, 
        galaToken, 
        relatedToken, 
        currentPrice, 
        api
      );
      
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  // Backward compatibility method
  async detectOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Filter pairs to only include GALA pairs
    const galaPairs = pairs.filter(pair => 
      pair.tokenClassA === 'GALA|Unit|none|none' || pair.tokenClassB === 'GALA|Unit|none|none'
    );
    
    // Group pairs by tokens to find cross-pair opportunities
    const pairsByToken = this.groupPairsByToken(galaPairs);
    
    for (const [token, tokenPairs] of pairsByToken.entries()) {
      if (tokenPairs.length < 2) continue;
      
      // Compare all pairs for this token
      for (let i = 0; i < tokenPairs.length; i++) {
        for (let j = i + 1; j < tokenPairs.length; j++) {
          const pairA = tokenPairs[i];
          const pairB = tokenPairs[j];
          
          const opportunity = await this.analyzePairArbitrage(pairA, pairB, api, quoteMap);
          if (opportunity) {
            opportunities.push(opportunity);
          }
        }
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private groupPairsByToken(pairs: TradingPair[]): Map<string, TradingPair[]> {
    const grouped = new Map<string, TradingPair[]>();
    
    for (const pair of pairs) {
      // Group by both tokens in the pair
      const tokenA = pair.tokenA.symbol;
      const tokenB = pair.tokenB.symbol;
      
      if (!grouped.has(tokenA)) {
        grouped.set(tokenA, []);
      }
      if (!grouped.has(tokenB)) {
        grouped.set(tokenB, []);
      }
      
      grouped.get(tokenA)!.push(pair);
      grouped.get(tokenB)!.push(pair);
    }
    
    return grouped;
  }

  private findRelatedTokensForArbitrage(swapData: SwapData, availableTokens: TokenInfo[], api: GSwapAPI): TokenInfo[] {
    const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';
    const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
    const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);
    
    // Find tokens that are NOT part of the current swap for triangular arbitrage
    const commonTokens = availableTokens.filter(token => 
      token.tokenClass !== GALA_TOKEN_CLASS && 
      token.tokenClass !== tokenInClassKey &&
      token.tokenClass !== tokenOutClassKey &&
      (token.symbol === 'GUSDT' || token.symbol === 'GWETH' || token.symbol === 'GWBTC')
    );
    
    return commonTokens.slice(0, 3); // Limit to 3 most common tokens for speed
  }

  private async analyzeTriangularArbitrage(
    swapData: SwapData,
    galaToken: TokenInfo,
    relatedToken: TokenInfo,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
      const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);
      const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';
      
      let path1: string, path2: string, path3: string;
      let token1ClassKey: string, token2ClassKey: string, token3ClassKey: string;
      
      if (tokenInClassKey === GALA_TOKEN_CLASS) {
        // GALA -> TOKEN swap, look for GALA -> TOKEN -> RELATED -> GALA triangular path
        path1 = `${swapData.tokenIn.collection} -> ${swapData.tokenOut.collection}`;
        path2 = `${swapData.tokenOut.collection} -> ${relatedToken.symbol}`;
        path3 = `${relatedToken.symbol} -> ${swapData.tokenIn.collection}`;
        token1ClassKey = tokenInClassKey;
        token2ClassKey = tokenOutClassKey;
        token3ClassKey = relatedToken.tokenClass;
      } else {
        // TOKEN -> GALA swap, look for TOKEN -> GALA -> RELATED -> TOKEN triangular path
        path1 = `${swapData.tokenIn.collection} -> ${swapData.tokenOut.collection}`;
        path2 = `${swapData.tokenOut.collection} -> ${relatedToken.symbol}`;
        path3 = `${relatedToken.symbol} -> ${swapData.tokenIn.collection}`;
        token1ClassKey = tokenInClassKey;
        token2ClassKey = tokenOutClassKey;
        token3ClassKey = relatedToken.tokenClass;
      }
      
      // Get quotes for the triangular path
      const testAmount = 1;
      const quote1 = await api.getQuote(token1ClassKey, token2ClassKey, testAmount);
      const quote2 = await api.getQuote(token2ClassKey, token3ClassKey, testAmount);
      const quote3 = await api.getQuote(token3ClassKey, token1ClassKey, testAmount);
      
      if (!quote1 || !quote2 || !quote3) return null;
      
      // Calculate if the triangular path is profitable
      const rate1 = quote1.outputAmount / quote1.inputAmount;
      const rate2 = quote2.outputAmount / quote2.inputAmount;
      const rate3 = quote3.outputAmount / quote3.inputAmount;
      
      const finalAmount = testAmount * rate1 * rate2 * rate3;
      const profitPercentage = ((finalAmount - testAmount) / testAmount) * 100;
      
      if (profitPercentage < config.minProfitThreshold) return null;
      
      // Check if we have sufficient funds
      const fundsCheck = await api.checkTradingFunds(config.maxTradeAmount, token1ClassKey, this.balanceSnapshot);
      
      return {
        id: `triangular-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tokenA: swapData.tokenIn.collection,
        tokenB: relatedToken.symbol,
        tokenClassA: token1ClassKey,
        tokenClassB: token3ClassKey,
        buyPrice: rate1 * rate2,
        sellPrice: 1 / rate3,
        profitPercentage,
        estimatedProfit: (profitPercentage / 100) * config.maxTradeAmount,
        maxTradeAmount: config.maxTradeAmount,
        buyQuote: quote1,
        sellQuote: quote3,
        hasFunds: fundsCheck.hasFunds,
        currentBalance: fundsCheck.currentBalance,
        shortfall: fundsCheck.shortfall,
        timestamp: Date.now(),
        currentMarketPrice: currentPrice,
        priceDiscrepancy: Math.abs(currentPrice - (rate1 * rate2)) / currentPrice * 100,
        confidence: profitPercentage
      };
    } catch (error) {
      console.error('Error analyzing triangular arbitrage:', error);
      return null;
    }
  }

  private async analyzePairArbitrage(
    pairA: TradingPair,
    pairB: TradingPair,
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Find common token between the pairs
      const commonToken = this.findCommonToken(pairA, pairB);
      if (!commonToken) return null;

      // Get quotes for both directions
      const testAmount = 1; // Test with 1 unit
      
      // Get quotes for A -> common token
      const quoteA1 = await getQuoteFromCacheOrApi(quoteMap, api, pairA.tokenClassA, pairA.tokenClassB, testAmount);
      const quoteA2 = await getQuoteFromCacheOrApi(quoteMap, api, pairA.tokenClassB, pairA.tokenClassA, testAmount);

      // Get quotes for B -> common token
      const quoteB1 = await getQuoteFromCacheOrApi(quoteMap, api, pairB.tokenClassA, pairB.tokenClassB, testAmount);
      const quoteB2 = await getQuoteFromCacheOrApi(quoteMap, api, pairB.tokenClassB, pairB.tokenClassA, testAmount);

      if (!quoteA1 || !quoteA2 || !quoteB1 || !quoteB2) return null;

      // Calculate exchange rates
      const rateA1 = quoteA1.outputAmount / quoteA1.inputAmount;
      const rateA2 = quoteA2.outputAmount / quoteA2.inputAmount;
      const rateB1 = quoteB1.outputAmount / quoteB1.inputAmount;
      const rateB2 = quoteB2.outputAmount / quoteB2.inputAmount;

      // Look for arbitrage opportunities
      let bestOpportunity: ArbitrageOpportunity | null = null;

      // Check A1 -> B2 arbitrage
      if (rateA1 > 0 && rateB2 > 0) {
        const profitPercentage = ((rateA1 - rateB2) / rateB2) * 100;
        if (profitPercentage > config.minProfitThreshold) {
          const opportunity = await this.createOpportunity(
            pairA, pairB, commonToken,
            rateA1, rateB2, profitPercentage,
            quoteA1, quoteB2, api
          );
          if (opportunity !== null && (!bestOpportunity || (opportunity as ArbitrageOpportunity).profitPercentage > (bestOpportunity as ArbitrageOpportunity).profitPercentage)) {
            bestOpportunity = opportunity;
          }
        }
      }

      // Check B1 -> A2 arbitrage
      if (rateB1 > 0 && rateA2 > 0) {
        const profitPercentage = ((rateB1 - rateA2) / rateA2) * 100;
        if (profitPercentage > config.minProfitThreshold) {
          const opportunity = await this.createOpportunity(
            pairB, pairA, commonToken,
            rateB1, rateA2, profitPercentage,
            quoteB1, quoteA2, api
          );
          if (opportunity !== null && (!bestOpportunity || (opportunity as ArbitrageOpportunity).profitPercentage > (bestOpportunity as ArbitrageOpportunity).profitPercentage)) {
            bestOpportunity = opportunity;
          }
        }
      }

      return bestOpportunity;
    } catch (error) {
      console.error('Error analyzing pair arbitrage:', error);
      return null;
    }
  }

  private findCommonToken(pairA: TradingPair, pairB: TradingPair): string | null {
    const tokensA = [pairA.tokenA.symbol, pairA.tokenB.symbol];
    const tokensB = [pairB.tokenA.symbol, pairB.tokenB.symbol];
    
    for (const token of tokensA) {
      if (tokensB.includes(token)) {
        return token;
      }
    }
    
    return null;
  }

  private async createOpportunity(
    buyPair: TradingPair,
    sellPair: TradingPair,
    commonToken: string,
    buyRate: number,
    sellRate: number,
    profitPercentage: number,
    buyQuote: SwapQuote,
    sellQuote: SwapQuote,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Calculate maximum trade amount based on available liquidity
      const maxTradeAmount = Math.min(
        config.maxTradeAmount,
        buyQuote.inputAmount * 10, // Simple liquidity estimate
        sellQuote.inputAmount * 10
      );

      if (maxTradeAmount <= 0) return null;

      const estimatedProfit = (sellRate - buyRate) * maxTradeAmount;

      // Check if we have sufficient funds for trading
      const fundsCheck = await api.checkTradingFunds(maxTradeAmount, buyPair.tokenClassA, this.balanceSnapshot);

      return {
        id: `arb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tokenA: buyPair.tokenA.symbol,
        tokenB: sellPair.tokenA.symbol,
        tokenClassA: buyPair.tokenClassA,
        tokenClassB: sellPair.tokenClassA,
        buyPrice: buyRate,
        sellPrice: sellRate,
        profitPercentage,
        estimatedProfit,
        maxTradeAmount,
        buyQuote,
        sellQuote,
        hasFunds: fundsCheck.hasFunds,
        currentBalance: fundsCheck.currentBalance,
        shortfall: fundsCheck.shortfall,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error creating opportunity:', error);
      return null;
    }
  }
}

export class DirectArbitrageStrategy implements ArbitrageStrategy {
  name = 'Direct Arbitrage';
  description = 'Detects arbitrage opportunities within the same trading pair (bid-ask spread)';

  constructor(private readonly balanceSnapshot: BalanceSnapshot) {}

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Get token class keys for the swap
    const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
    const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);
    
    // Only analyze if GALA is involved
    const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';
    if (tokenInClassKey !== GALA_TOKEN_CLASS && tokenOutClassKey !== GALA_TOKEN_CLASS) {
      return opportunities;
    }
    
    try {
      const opportunity = await this.analyzeDirectArbitrageForSwap(swapData, currentPrice, api);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    } catch (error) {
      console.error(`Error analyzing direct arbitrage for ${swapData.tokenIn.collection}-${swapData.tokenOut.collection}:`, error);
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  // Backward compatibility method
  async detectOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Filter pairs to only include GALA pairs
    const galaPairs = pairs.filter(pair => 
      pair.tokenClassA === 'GALA|Unit|none|none' || pair.tokenClassB === 'GALA|Unit|none|none'
    );
    
    for (const pair of galaPairs) {
      try {
        const opportunity = await this.analyzeDirectArbitrage(pair, api, quoteMap);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        console.error(`Error analyzing direct arbitrage for ${pair.tokenA.symbol}-${pair.tokenB.symbol}:`, error);
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async analyzeDirectArbitrageForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const tokenInClassKey = api.createTokenClassKey(swapData.tokenIn);
      const tokenOutClassKey = api.createTokenClassKey(swapData.tokenOut);
      
      const testAmount = 1;
      
      // Get quotes in both directions for the exact pair that was swapped
      const quoteAB = await api.getQuote(tokenInClassKey, tokenOutClassKey, testAmount);
      const quoteBA = await api.getQuote(tokenOutClassKey, tokenInClassKey, testAmount);
      
      if (!quoteAB || !quoteBA) return null;

      const rateAB = quoteAB.outputAmount / quoteAB.inputAmount;
      const rateBA = quoteBA.outputAmount / quoteBA.inputAmount;
      
      // Check for invalid rates
      if (!isFinite(rateAB) || !isFinite(rateBA) || rateAB <= 0 || rateBA <= 0) {
        return null;
      }
      
      // Check if there's a profitable spread
      const spread = rateAB - (1 / rateBA);
      const profitPercentage = (spread / (1 / rateBA)) * 100;
      
      // Check for invalid profit calculation
      if (!isFinite(profitPercentage) || !isFinite(spread)) {
        return null;
      }
      
      if (profitPercentage < config.minProfitThreshold) return null;

      const maxTradeAmount = Math.min(
        config.maxTradeAmount,
        quoteAB.inputAmount * 10,
        quoteBA.inputAmount * 10
      );

      if (maxTradeAmount <= 0) return null;

      // Check if we have sufficient funds for trading
      const fundsCheck = await api.checkTradingFunds(maxTradeAmount, tokenInClassKey, this.balanceSnapshot);

      const buyPrice = 1 / rateBA;
      const sellPrice = rateAB;
      const estimatedProfit = spread * maxTradeAmount;
      const priceDiscrepancy = Math.abs(currentPrice - rateAB) / currentPrice * 100;

      // Final validation before creating opportunity
      if (!isFinite(buyPrice) || !isFinite(sellPrice) || !isFinite(estimatedProfit) || !isFinite(priceDiscrepancy)) {
        console.log(`     Direct arbitrage analysis: Invalid final values (buyPrice: ${buyPrice}, sellPrice: ${sellPrice}, estimatedProfit: ${estimatedProfit}, priceDiscrepancy: ${priceDiscrepancy})`);
        return null;
      }

      return {
        id: `direct-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tokenA: swapData.tokenIn.collection,
        tokenB: swapData.tokenOut.collection,
        tokenClassA: tokenInClassKey,
        tokenClassB: tokenOutClassKey,
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
        currentMarketPrice: currentPrice,
        priceDiscrepancy,
        confidence: profitPercentage
      };
    } catch (error) {
      console.error('Error analyzing direct arbitrage for swap:', error);
      return null;
    }
  }

  private async analyzeDirectArbitrage(
    pair: TradingPair,
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const testAmount = 1;

      // Get quotes in both directions
      const quoteAB = await getQuoteFromCacheOrApi(quoteMap, api, pair.tokenClassA, pair.tokenClassB, testAmount);
      const quoteBA = await getQuoteFromCacheOrApi(quoteMap, api, pair.tokenClassB, pair.tokenClassA, testAmount);
      
      if (!quoteAB || !quoteBA) return null;

      const rateAB = quoteAB.outputAmount / quoteAB.inputAmount;
      const rateBA = quoteBA.outputAmount / quoteBA.inputAmount;
      
      // Check if there's a profitable spread
      const spread = rateAB - (1 / rateBA);
      const profitPercentage = (spread / (1 / rateBA)) * 100;
      
      if (profitPercentage < config.minProfitThreshold) return null;

      const maxTradeAmount = Math.min(
        config.maxTradeAmount,
        quoteAB.inputAmount * 10,
        quoteBA.inputAmount * 10
      );

      if (maxTradeAmount <= 0) return null;

      // Check if we have sufficient funds for trading
      const fundsCheck = await api.checkTradingFunds(maxTradeAmount, pair.tokenClassA, this.balanceSnapshot);

      return {
        id: `direct-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tokenA: pair.tokenA.symbol,
        tokenB: pair.tokenB.symbol,
        tokenClassA: pair.tokenClassA,
        tokenClassB: pair.tokenClassB,
        buyPrice: 1 / rateBA,
        sellPrice: rateAB,
        profitPercentage,
        estimatedProfit: spread * maxTradeAmount,
        maxTradeAmount,
        buyQuote: quoteBA,
        sellQuote: quoteAB,
        hasFunds: fundsCheck.hasFunds,
        currentBalance: fundsCheck.currentBalance,
        shortfall: fundsCheck.shortfall,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error analyzing direct arbitrage:', error);
      return null;
    }
  }
}

export class ArbitrageDetector {
  private readonly strategyConstructors: ArbitrageStrategyConstructor[];

  constructor(strategyConstructors?: ArbitrageStrategyConstructor[]) {
    this.strategyConstructors = strategyConstructors ?? [
      CrossPairArbitrageStrategy,
      DirectArbitrageStrategy,
    ];
  }

  private instantiateStrategies(balanceSnapshot: BalanceSnapshot): ArbitrageStrategy[] {
    return this.strategyConstructors.map(StrategyCtor => new StrategyCtor(balanceSnapshot));
  }

  async detectOpportunitiesForSwap(
    swapData: SwapData,
    currentPrice: number,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const allOpportunities: ArbitrageOpportunity[] = [];

    const balanceSnapshot = await api.getBalanceSnapshot();
    const strategies = this.instantiateStrategies(balanceSnapshot);

    for (const strategy of strategies) {
      try {
        const opportunities = await strategy.detectOpportunitiesForSwap(swapData, currentPrice, api);
        allOpportunities.push(...opportunities);
      } catch (error) {
        console.error(`Error in strategy ${strategy.name}:`, error);
      }
    }
    
    // Remove duplicates and sort by profit
    const uniqueOpportunities = this.removeDuplicateOpportunities(allOpportunities);
    return uniqueOpportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  // Keep the old method for backward compatibility (if needed elsewhere)
  async detectAllOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI,
    quoteMap: QuoteMap
  ): Promise<ArbitrageOpportunity[]> {
    const allOpportunities: ArbitrageOpportunity[] = [];

    const balanceSnapshot = await api.getBalanceSnapshot();
    const strategies = this.instantiateStrategies(balanceSnapshot);

    for (const strategy of strategies) {
      try {
        console.log(`🔍 Running ${strategy.name}...`);
        const opportunities = strategy.detectOpportunities ? await strategy.detectOpportunities(pairs, api, quoteMap) : [];
        console.log(`   Found ${opportunities.length} opportunities`);
        allOpportunities.push(...opportunities);
      } catch (error) {
        console.error(`Error in strategy ${strategy.name}:`, error);
      }
    }
    
    // Remove duplicates and sort by profit
    const uniqueOpportunities = this.removeDuplicateOpportunities(allOpportunities);
    return uniqueOpportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private removeDuplicateOpportunities(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
    const seen = new Set<string>();
    return opportunities.filter(opp => {
      const key = `${opp.tokenA}-${opp.tokenB}-${opp.tokenClassA}-${opp.tokenClassB}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}