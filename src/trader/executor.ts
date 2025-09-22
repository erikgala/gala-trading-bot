import { GSwapAPI, SwapQuote, SwapResult } from '../api/gswap';
import { ArbitrageOpportunity } from '../strategies/arbitrage';
import { config } from '../config';

export interface TradeExecution {
  id: string;
  opportunity: ArbitrageOpportunity;
  buySwap?: SwapResult;
  sellSwap?: SwapResult;
  status: 'pending' | 'buying' | 'selling' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  actualProfit?: number;
  error?: string;
}

export class TradeExecutor {
  private readonly activeTrades = new Map<string, TradeExecution>();

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
      await this.runDirectArbitrage(execution);

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
    }

    return execution;
  }

  private async runDirectArbitrage(execution: TradeExecution): Promise<void> {
    const originalOpportunity = execution.opportunity;
    const amountToTrade = originalOpportunity.maxTradeAmount;

    if (!Number.isFinite(amountToTrade) || amountToTrade <= 0) {
      throw new Error('Invalid trade amount for opportunity');
    }

    this.ensureNotCancelled(execution);
    const refreshedBuyQuote = await this.api.getQuote(
      originalOpportunity.tokenClassA,
      originalOpportunity.tokenClassB,
      amountToTrade
    );

    if (
      !refreshedBuyQuote ||
      !Number.isFinite(refreshedBuyQuote.outputAmount) ||
      !Number.isFinite(refreshedBuyQuote.inputAmount) ||
      refreshedBuyQuote.inputAmount <= 0 ||
      refreshedBuyQuote.outputAmount <= 0
    ) {
      throw new Error('Unable to refresh buy quote for opportunity');
    }

    this.ensureNotCancelled(execution);
    const refreshedSellQuote = await this.api.getQuote(
      originalOpportunity.tokenClassB,
      originalOpportunity.tokenClassA,
      refreshedBuyQuote.outputAmount
    );

    if (
      !refreshedSellQuote ||
      !Number.isFinite(refreshedSellQuote.outputAmount) ||
      !Number.isFinite(refreshedSellQuote.inputAmount) ||
      refreshedSellQuote.inputAmount <= 0 ||
      refreshedSellQuote.outputAmount <= 0
    ) {
      throw new Error('Unable to refresh sell quote for opportunity');
    }

    const sellRate = refreshedBuyQuote.outputAmount / refreshedBuyQuote.inputAmount;
    const buyRate = refreshedSellQuote.outputAmount / refreshedSellQuote.inputAmount;

    if (!Number.isFinite(sellRate) || !Number.isFinite(buyRate) || sellRate <= 0 || buyRate <= 0) {
      throw new Error('Invalid refreshed quote rates');
    }

    const buyPrice = 1 / buyRate;
    const sellPrice = sellRate;
    const spread = sellPrice - buyPrice;
    const profitPercentage = (spread / buyPrice) * 100;
    const estimatedProfit = spread * amountToTrade;

    const refreshedOpportunity: ArbitrageOpportunity = {
      ...originalOpportunity,
      buyPrice,
      sellPrice,
      profitPercentage,
      estimatedProfit,
      quoteAToB: refreshedBuyQuote,
      quoteBToA: refreshedSellQuote,
      maxTradeAmount: amountToTrade,
    };

    execution.opportunity = refreshedOpportunity;

    if (
      !Number.isFinite(profitPercentage) ||
      !Number.isFinite(estimatedProfit) ||
      profitPercentage < config.minProfitThreshold ||
      estimatedProfit <= 0
    ) {
      this.cancelExecution(execution, 'Opportunity no longer profitable after re-quoting');
      return;
    }

    this.ensureNotCancelled(execution);
    execution.status = 'buying';
    const buySwap = await this.executeSwap(
      execution,
      refreshedOpportunity.tokenClassA,
      refreshedOpportunity.tokenClassB,
      amountToTrade,
      refreshedOpportunity.quoteAToB
    );
    execution.buySwap = buySwap;

    this.ensureNotCancelled(execution);
    execution.status = 'selling';
    const sellSwap = await this.executeSwap(
      execution,
      refreshedOpportunity.tokenClassB,
      refreshedOpportunity.tokenClassA,
      buySwap.outputAmount,
      refreshedOpportunity.quoteBToA
    );
    execution.sellSwap = sellSwap;

    execution.actualProfit = sellSwap.outputAmount - buySwap.inputAmount;
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
    return this.activeTrades.get(id);
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
    const trades = this.getActiveTrades();
    const completedTrades = trades.filter(trade => trade.status === 'completed');
    const failedTrades = trades.filter(trade => trade.status === 'failed');

    const totalProfit = completedTrades.reduce(
      (sum, trade) => sum + (trade.actualProfit ?? 0),
      0
    );
    const averageProfit = completedTrades.length > 0 ? totalProfit / completedTrades.length : 0;
    const successRate = trades.length > 0 ? (completedTrades.length / trades.length) * 100 : 0;

    return {
      totalTrades: trades.length,
      completedTrades: completedTrades.length,
      failedTrades: failedTrades.length,
      totalProfit,
      averageProfit,
      successRate,
    };
  }

  getTradeHistory(): TradeExecution[] {
    return this.getActiveTrades().sort((a, b) => b.startTime - a.startTime);
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
}
