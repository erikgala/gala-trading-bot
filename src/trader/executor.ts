import { GSwapAPI, SwapQuote, SwapResult } from '../api/gswap';
import { ArbitrageOpportunity, DirectArbitrageOpportunity } from '../strategies/arbitrage';
import type { TriangularArbitrageOpportunity } from '../strategies/triangularArbitrage';
import { config } from '../config';

export interface TradeExecution {
  id: string;
  opportunity: ArbitrageOpportunity;
  buySwap?: SwapResult;
  sellSwap?: SwapResult;
  intermediateSwaps?: SwapResult[];
  status: 'pending' | 'buying' | 'selling' | 'converting' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  actualProfit?: number;
  error?: string;
}

export class TradeExecutor {
  private readonly activeTrades = new Map<string, TradeExecution>();
  private readonly tradeHistory: TradeExecution[] = [];

  constructor(private readonly api: GSwapAPI) {}

  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<TradeExecution> {
    const execution: TradeExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      opportunity,
      status: 'pending',
      startTime: Date.now(),
    };

    if (this.activeTrades.size >= config.maxConcurrentTrades) {
      execution.status = 'failed';
      execution.error = 'Maximum concurrent trades exceeded';
      execution.endTime = Date.now();
      return execution;
    }

    this.activeTrades.set(execution.id, execution);

    try {
      if (opportunity.strategy === 'direct') {
        await this.runDirectArbitrage(execution, opportunity);
      } else {
        await this.runTriangularArbitrage(execution, opportunity);
      }

      if (execution.status !== 'cancelled') {
        execution.status = 'completed';
        execution.endTime = Date.now();
      }
    } catch (error) {
      if (execution.status === 'cancelled') {
        execution.error = 'Trade cancelled';
        execution.endTime ??= Date.now();
      } else {
        execution.status = 'failed';
        execution.error = error instanceof Error ? error.message : 'Unknown error';
        execution.endTime = Date.now();
      }
    } finally {
      this.finalizeExecution(execution);
    }

    return execution;
  }

  private async runDirectArbitrage(
    execution: TradeExecution,
    originalOpportunity: DirectArbitrageOpportunity,
  ): Promise<void> {
    const amountToTrade = originalOpportunity.maxTradeAmount;

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      throw new Error('Invalid trade amount for opportunity');
    }

    if (
      !Number.isFinite(originalOpportunity.profitPercentage) ||
      originalOpportunity.profitPercentage < config.minProfitThreshold ||
      !Number.isFinite(originalOpportunity.estimatedProfit) ||
      originalOpportunity.estimatedProfit <= 0
    ) {
      this.cancelExecution(execution, 'Opportunity no longer meets profit requirements');
      return;
    }

    const buyQuote = this.validateQuote(
      originalOpportunity.quoteAToB,
      originalOpportunity.tokenClassA,
      originalOpportunity.tokenClassB,
      amountToTrade,
    );

    this.ensureNotCancelled(execution);
    execution.status = 'buying';
    const buySwap = await this.executeSwap(
      execution,
      originalOpportunity.tokenClassA,
      originalOpportunity.tokenClassB,
      amountToTrade,
      buyQuote
    );
    execution.buySwap = buySwap;

    const sellInputAmount = buySwap.outputAmount;
    const sellQuote = this.validateQuote(
      originalOpportunity.quoteBToA,
      originalOpportunity.tokenClassB,
      originalOpportunity.tokenClassA,
      sellInputAmount,
    );

    this.ensureNotCancelled(execution);
    execution.status = 'selling';
    const sellSwap = await this.executeSwap(
      execution,
      originalOpportunity.tokenClassB,
      originalOpportunity.tokenClassA,
      sellInputAmount,
      sellQuote
    );
    execution.sellSwap = sellSwap;

    execution.actualProfit = sellSwap.outputAmount - buySwap.inputAmount;
  }

  private async runTriangularArbitrage(
    execution: TradeExecution,
    originalOpportunity: TriangularArbitrageOpportunity,
  ): Promise<void> {
    const amountToTrade = originalOpportunity.maxTradeAmount;

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      throw new Error('Invalid trade amount for opportunity');
    }

    if (
      !Number.isFinite(originalOpportunity.profitPercentage) ||
      originalOpportunity.profitPercentage < config.minProfitThreshold ||
      !Number.isFinite(originalOpportunity.estimatedProfit) ||
      originalOpportunity.estimatedProfit <= 0
    ) {
      this.cancelExecution(execution, 'Triangular opportunity no longer meets profit requirements');
      return;
    }

    execution.intermediateSwaps = [];

    let currentAmount = amountToTrade;

    for (let index = 0; index < originalOpportunity.path.length; index++) {
      const leg = originalOpportunity.path[index];
      const expectedInputAmount =
        index === 0 ? amountToTrade : originalOpportunity.path[index - 1].quote.outputAmount;
      const quote = this.validateQuote(
        leg.quote,
        leg.fromTokenClass,
        leg.toTokenClass,
        expectedInputAmount,
      );

      this.ensureNotCancelled(execution);

      if (index === 0) {
        execution.status = 'buying';
      } else if (index === originalOpportunity.path.length - 1) {
        execution.status = 'selling';
      } else {
        execution.status = 'converting';
      }

      const swapResult = await this.executeSwap(
        execution,
        leg.fromTokenClass,
        leg.toTokenClass,
        currentAmount,
        quote,
      );

      if (index === 0) {
        execution.buySwap = swapResult;
      } else if (index === originalOpportunity.path.length - 1) {
        execution.sellSwap = swapResult;
      } else {
        execution.intermediateSwaps.push(swapResult);
      }

      currentAmount = swapResult.outputAmount;
    }

    execution.actualProfit = currentAmount - amountToTrade;
  }

  private validateQuote(
    quote: SwapQuote | undefined,
    inputTokenClass: string,
    outputTokenClass: string,
    expectedInputAmount: number,
  ): SwapQuote {
    if (
      !quote ||
      quote.inputToken !== inputTokenClass ||
      quote.outputToken !== outputTokenClass ||
      !Number.isFinite(quote.inputAmount) ||
      !Number.isFinite(quote.outputAmount) ||
      quote.inputAmount <= 0 ||
      quote.outputAmount <= 0
    ) {
      throw new Error('Invalid cached quote for opportunity');
    }

    const tolerance = Math.max(1e-8, Math.abs(expectedInputAmount) * 1e-6);

    if (Math.abs(quote.inputAmount - expectedInputAmount) > tolerance) {
      throw new Error('Cached quote amount mismatch for opportunity');
    }

    return quote;
  }

  private async executeSwap(
    execution: TradeExecution,
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    quote?: SwapQuote
  ): Promise<SwapResult> {
    this.ensureNotCancelled(execution);

    const result = await this.api.executeSwap(
      inputTokenClass,
      outputTokenClass,
      inputAmount,
      config.slippageTolerance,
      quote
    );

    if (!result?.transactionHash) {
      throw new Error('Swap execution failed');
    }

    this.ensureNotCancelled(execution);

    console.log(`✅ Swap executed successfully: ${result.transactionHash}`);
    console.log(`   Input: ${result.inputAmount}`);
    console.log(`   Output: ${result.outputAmount}`);
    console.log(`   Price: ${result.actualPrice.toFixed(6)}`);

    return result;
  }

  private ensureNotCancelled(execution: TradeExecution): void {
    if (execution.status === 'cancelled') {
      throw new Error('Trade cancelled');
    }
  }

  private cancelExecution(execution: TradeExecution, reason: string): void {
    execution.status = 'cancelled';
    execution.error = reason;
    execution.endTime = Date.now();
  }

  getActiveTrades(): TradeExecution[] {
    return Array.from(this.activeTrades.values());
  }

  getTradeExecution(id: string): TradeExecution | undefined {
    return this.activeTrades.get(id) ?? this.tradeHistory.find(trade => trade.id === id);
  }

  async cancelTradeExecution(id: string): Promise<boolean> {
    const execution = this.activeTrades.get(id);
    if (!execution) {
      return false;
    }

    if (execution.status === 'completed' || execution.status === 'failed') {
      return false;
    }

    execution.status = 'cancelled';
    execution.error = 'Trade cancelled';
    execution.endTime = Date.now();
    return true;
  }

  getTradingStats(): {
    totalTrades: number;
    completedTrades: number;
    failedTrades: number;
    totalProfit: number;
    averageProfit: number;
    successRate: number;
  } {
    const activeTrades = this.getActiveTrades();
    const historicalTrades = [...this.tradeHistory];
    const completedTrades = historicalTrades.filter(trade => trade.status === 'completed');
    const failedTrades = historicalTrades.filter(trade => trade.status === 'failed');

    const totalTrades = historicalTrades.length + activeTrades.length;
    const totalProfit = completedTrades.reduce(
      (sum, trade) => sum + (trade.actualProfit ?? 0),
      0
    );
    const averageProfit = completedTrades.length > 0 ? totalProfit / completedTrades.length : 0;
    const successRate = totalTrades > 0 ? (completedTrades.length / totalTrades) * 100 : 0;

    return {
      totalTrades,
      completedTrades: completedTrades.length,
      failedTrades: failedTrades.length,
      totalProfit,
      averageProfit,
      successRate,
    };
  }

  getTradeHistory(): TradeExecution[] {
    const combinedHistory = [...this.tradeHistory, ...this.getActiveTrades()];
    return combinedHistory.sort((a, b) => b.startTime - a.startTime);
  }

  canExecuteTrade(): boolean {
    return this.activeTrades.size < config.maxConcurrentTrades;
  }

  getTradingCapacity(): { current: number; max: number; available: number } {
    const max = config.maxConcurrentTrades;
    const current = this.activeTrades.size;
    return {
      current,
      max,
      available: Math.max(0, max - current),
    };
  }

  private finalizeExecution(execution: TradeExecution): void {
    this.activeTrades.delete(execution.id);

    const terminalStatuses: TradeExecution['status'][] = ['completed', 'failed', 'cancelled'];
    if (terminalStatuses.includes(execution.status)) {
      this.tradeHistory.push({ ...execution });
    }
  }
}
