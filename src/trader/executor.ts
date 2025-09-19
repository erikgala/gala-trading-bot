import { GSwapAPI, SwapResult } from '../api/gswap';
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
  private activeTrades: Map<string, TradeExecution> = new Map();
  private maxRetries = 3;
  private retryDelay = 2000; // 2 seconds

  constructor(private api: GSwapAPI) {}

  /**
   * Execute an arbitrage opportunity
   */
  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<TradeExecution> {
    const execution: TradeExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      opportunity,
      status: 'pending',
      startTime: Date.now(),
    };

    this.activeTrades.set(execution.id, execution);

    try {
      console.log(`🚀 Starting arbitrage execution: ${execution.id}`);
      console.log(`💰 Opportunity: ${opportunity.tokenA} -> ${opportunity.tokenB}`);
      console.log(`📊 Buy price: ${opportunity.buyPrice.toFixed(6)}`);
      console.log(`📊 Sell price: ${opportunity.sellPrice.toFixed(6)}`);
      console.log(`📈 Expected profit: ${opportunity.profitPercentage.toFixed(2)}% (${opportunity.estimatedProfit.toFixed(2)})`);

      // Check if we have too many concurrent trades
      if (this.activeTrades.size > config.maxConcurrentTrades) {
        throw new Error('Maximum concurrent trades exceeded');
      }

      // Execute the arbitrage
      await this.executeArbitrageSteps(execution);

      if (this.isExecutionCancelled(execution)) {
        if (!execution.endTime) {
          execution.endTime = Date.now();
        }
        console.log(`🛑 Arbitrage execution cancelled before completion: ${execution.id}`);
      } else {
        execution.status = 'completed';
        execution.endTime = Date.now();

        console.log(`✅ Arbitrage execution completed: ${execution.id}`);
        console.log(`💰 Actual profit: ${execution.actualProfit?.toFixed(2) || 'Unknown'}`);
      }

    } catch (error) {
      if (this.isExecutionCancelled(execution)) {
        if (!execution.endTime) {
          execution.endTime = Date.now();
        }
        console.log(`🛑 Arbitrage execution cancelled during processing: ${execution.id}`);
      } else {
        execution.status = 'failed';
        execution.error = error instanceof Error ? error.message : 'Unknown error';
        execution.endTime = Date.now();

        console.error(`❌ Arbitrage execution failed: ${execution.id}`, error);
      }
    } finally {
      // Clean up completed trades after a delay
      const cleanupTimer = setTimeout(() => {
        this.activeTrades.delete(execution.id);
      }, 300000); // 5 minutes

      cleanupTimer.unref?.();
    }

    return execution;
  }

  private async executeArbitrageSteps(execution: TradeExecution): Promise<void> {
    const { opportunity } = execution;

    // Step 1: Execute buy swap
    this.throwIfCancelled(execution);
    execution.status = 'buying';
    console.log(`🔄 Executing buy swap: ${opportunity.tokenClassA} -> ${opportunity.tokenClassB}`);

    const buySwap = await this.executeSwapWithRetry(
      execution,
      opportunity.tokenClassA,
      opportunity.tokenClassB,
      opportunity.maxTradeAmount,
      opportunity.buyQuote,
      'Buy swap failed'
    ).catch(error => {
      throw error instanceof Error ? error : new Error('Buy swap failed');
    });

    if (!buySwap || !buySwap.transactionHash) {
      throw new Error('Buy swap failed');
    }

    execution.buySwap = buySwap;
    console.log(`✅ Buy swap completed: ${buySwap.transactionHash}`);

    // Step 2: Execute sell swap
    this.throwIfCancelled(execution);
    execution.status = 'selling';
    console.log(`🔄 Executing sell swap: ${opportunity.tokenClassB} -> ${opportunity.tokenClassA}`);

    const sellSwap = await this.executeSwapWithRetry(
      execution,
      opportunity.tokenClassB,
      opportunity.tokenClassA,
      buySwap.outputAmount, // Use the output from the buy swap
      opportunity.sellQuote,
      'Sell swap failed'
    ).catch(error => {
      throw error instanceof Error ? error : new Error('Sell swap failed');
    });

    if (!sellSwap || !sellSwap.transactionHash) {
      throw new Error('Sell swap failed');
    }

    execution.sellSwap = sellSwap;
    console.log(`✅ Sell swap completed: ${sellSwap.transactionHash}`);

    // Calculate actual profit
    if (execution.buySwap && execution.sellSwap) {
      const totalCost = execution.buySwap.inputAmount;
      const totalRevenue = execution.sellSwap.outputAmount;
      execution.actualProfit = totalRevenue - totalCost;
    }
  }

  private async executeSwapWithRetry(
    execution: TradeExecution,
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    _expectedQuote: any,
    failureMessage: string
  ): Promise<SwapResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      this.throwIfCancelled(execution);
      try {
        console.log(`🔄 Executing swap (attempt ${attempt}/${this.maxRetries})`);
        console.log(`   ${inputTokenClass} -> ${outputTokenClass}`);
        console.log(`   Amount: ${inputAmount}`);

        const result = await this.api.executeSwap(
          inputTokenClass,
          outputTokenClass,
          inputAmount,
          config.slippageTolerance
        );

        if (!result || !result.transactionHash) {
          throw new Error(failureMessage);
        }

        console.log(`✅ Swap executed successfully: ${result.transactionHash}`);
        console.log(`   Input: ${result.inputAmount}`);
        console.log(`   Output: ${result.outputAmount}`);
        console.log(`   Price: ${result.actualPrice.toFixed(6)}`);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(failureMessage);

        if (this.isExecutionCancelled(execution)) {
          throw new Error('Trade execution cancelled');
        }

        console.warn(`⚠️  Swap execution failed (attempt ${attempt}/${this.maxRetries}):`, lastError.message);

        if (lastError.message !== 'Swap execution failed' && lastError.message !== 'Trade execution cancelled') {
          throw lastError;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error(failureMessage);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isExecutionCancelled(execution: TradeExecution): boolean {
    return execution.status === 'cancelled';
  }

  private throwIfCancelled(execution: TradeExecution): void {
    if (this.isExecutionCancelled(execution)) {
      throw new Error('Trade execution cancelled');
    }
  }

  /**
   * Get all active trades
   */
  getActiveTrades(): TradeExecution[] {
    return Array.from(this.activeTrades.values());
  }

  /**
   * Get trade execution by ID
   */
  getTradeExecution(id: string): TradeExecution | undefined {
    return this.activeTrades.get(id);
  }

  /**
   * Cancel a specific trade execution
   */
  async cancelTradeExecution(id: string): Promise<boolean> {
    const execution = this.activeTrades.get(id);
    if (!execution) {
      return false;
    }

    execution.status = 'cancelled';
    execution.endTime = Date.now();
    
    console.log(`🛑 Trade execution cancelled: ${id}`);
    return true;
  }

  /**
   * Get trading statistics
   */
  getTradingStats(): {
    totalTrades: number;
    completedTrades: number;
    failedTrades: number;
    totalProfit: number;
    averageProfit: number;
    successRate: number;
  } {
    const trades = Array.from(this.activeTrades.values());
    const completedTrades = trades.filter(t => t.status === 'completed');
    const failedTrades = trades.filter(t => t.status === 'failed');
    
    const totalProfit = completedTrades.reduce((sum, t) => sum + (t.actualProfit || 0), 0);
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

  /**
   * Get detailed trade history
   */
  getTradeHistory(): TradeExecution[] {
    return Array.from(this.activeTrades.values()).sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Check if we can execute a new trade
   */
  canExecuteTrade(): boolean {
    return this.activeTrades.size < config.maxConcurrentTrades;
  }

  /**
   * Get current trading capacity
   */
  getTradingCapacity(): { current: number; max: number; available: number } {
    return {
      current: this.activeTrades.size,
      max: config.maxConcurrentTrades,
      available: config.maxConcurrentTrades - this.activeTrades.size
    };
  }
}