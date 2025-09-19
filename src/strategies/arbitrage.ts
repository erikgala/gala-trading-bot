import { GSwapAPI, TradingPair, SwapQuote } from '../api/gswap';
import { config } from '../config';

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
  timestamp: number;
}

export interface ArbitrageStrategy {
  name: string;
  description: string;
  detectOpportunities(pairs: TradingPair[], api: GSwapAPI): Promise<ArbitrageOpportunity[]>;
}

export class CrossPairArbitrageStrategy implements ArbitrageStrategy {
  name = 'Cross-Pair Arbitrage';
  description = 'Detects arbitrage opportunities between different trading pairs for the same token';

  async detectOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Group pairs by tokens to find cross-pair opportunities
    const pairsByToken = this.groupPairsByToken(pairs);
    
    for (const [token, tokenPairs] of pairsByToken.entries()) {
      if (tokenPairs.length < 2) continue;
      
      // Compare all pairs for this token
      for (let i = 0; i < tokenPairs.length; i++) {
        for (let j = i + 1; j < tokenPairs.length; j++) {
          const pairA = tokenPairs[i];
          const pairB = tokenPairs[j];
          
          const opportunity = await this.analyzePairArbitrage(pairA, pairB, api);
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

  private async analyzePairArbitrage(
    pairA: TradingPair,
    pairB: TradingPair,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Find common token between the pairs
      const commonToken = this.findCommonToken(pairA, pairB);
      if (!commonToken) return null;

      // Get quotes for both directions
      const testAmount = 1; // Test with 1 unit
      
      // Get quotes for A -> common token
      const quoteA1 = await api.getQuote(pairA.tokenClassA, pairA.tokenClassB, testAmount);
      const quoteA2 = await api.getQuote(pairA.tokenClassB, pairA.tokenClassA, testAmount);
      
      // Get quotes for B -> common token  
      const quoteB1 = await api.getQuote(pairB.tokenClassA, pairB.tokenClassB, testAmount);
      const quoteB2 = await api.getQuote(pairB.tokenClassB, pairB.tokenClassA, testAmount);

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
          const opportunity = this.createOpportunity(
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
          const opportunity = this.createOpportunity(
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

  private createOpportunity(
    buyPair: TradingPair,
    sellPair: TradingPair,
    commonToken: string,
    buyRate: number,
    sellRate: number,
    profitPercentage: number,
    buyQuote: SwapQuote,
    sellQuote: SwapQuote,
    api: GSwapAPI
  ): ArbitrageOpportunity | null {
    try {
      // Calculate maximum trade amount based on available liquidity
      const maxTradeAmount = Math.min(
        config.maxTradeAmount,
        buyQuote.inputAmount * 10, // Simple liquidity estimate
        sellQuote.inputAmount * 10
      );

      if (maxTradeAmount <= 0) return null;

      const estimatedProfit = (sellRate - buyRate) * maxTradeAmount;

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

  async detectOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    for (const pair of pairs) {
      try {
        const opportunity = await this.analyzeDirectArbitrage(pair, api);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      } catch (error) {
        console.error(`Error analyzing direct arbitrage for ${pair.tokenA.symbol}-${pair.tokenB.symbol}:`, error);
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }

  private async analyzeDirectArbitrage(
    pair: TradingPair,
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const testAmount = 1;
      
      // Get quotes in both directions
      const quoteAB = await api.getQuote(pair.tokenClassA, pair.tokenClassB, testAmount);
      const quoteBA = await api.getQuote(pair.tokenClassB, pair.tokenClassA, testAmount);
      
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
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error analyzing direct arbitrage:', error);
      return null;
    }
  }
}

export class ArbitrageDetector {
  private strategies: ArbitrageStrategy[];

  constructor() {
    this.strategies = [
      new CrossPairArbitrageStrategy(),
      new DirectArbitrageStrategy(),
    ];
  }

  async detectAllOpportunities(
    pairs: TradingPair[],
    api: GSwapAPI
  ): Promise<ArbitrageOpportunity[]> {
    const allOpportunities: ArbitrageOpportunity[] = [];
    
    for (const strategy of this.strategies) {
      try {
        console.log(`🔍 Running ${strategy.name}...`);
        const opportunities = await strategy.detectOpportunities(pairs, api);
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