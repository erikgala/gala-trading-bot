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

      execution.status = 'completed';
      execution.endTime = Date.now();
      
      console.log(`✅ Arbitrage execution completed: ${execution.id}`);
      console.log(`💰 Actual profit: ${execution.actualProfit?.toFixed(2) || 'Unknown'}`);

    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.endTime = Date.now();
      
      console.error(`❌ Arbitrage execution failed: ${execution.id}`, error);
    } finally {
      // Clean up completed trades after a delay
      setTimeout(() => {
        this.activeTrades.delete(execution.id);
      }, 300000); // 5 minutes
    }

    return execution;
  }

  private async executeArbitrageSteps(execution: TradeExecution): Promise<void> {
    const { opportunity } = execution;

    // Step 1: Execute buy swap
    execution.status = 'buying';
    console.log(`🔄 Executing buy swap: ${opportunity.tokenClassA} -> ${opportunity.tokenClassB}`);
    
    const buySwap = await this.executeSwapWithRetry(
      opportunity.tokenClassA,
      opportunity.tokenClassB,
      opportunity.maxTradeAmount,
      opportunity.buyQuote
    );

    execution.buySwap = buySwap;
    console.log(`✅ Buy swap completed: ${buySwap.transactionHash}`);

    // Step 2: Execute sell swap
    execution.status = 'selling';
    console.log(`🔄 Executing sell swap: ${opportunity.tokenClassB} -> ${opportunity.tokenClassA}`);
    
    const sellSwap = await this.executeSwapWithRetry(
      opportunity.tokenClassB,
      opportunity.tokenClassA,
      buySwap.outputAmount, // Use the output from the buy swap
      opportunity.sellQuote
    );

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
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    expectedQuote: any
  ): Promise<SwapResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
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
        
        console.log(`✅ Swap executed successfully: ${result.transactionHash}`);
        console.log(`   Input: ${result.inputAmount}`);
        console.log(`   Output: ${result.outputAmount}`);
        console.log(`   Price: ${result.actualPrice.toFixed(6)}`);
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        console.warn(`⚠️  Swap execution failed (attempt ${attempt}/${this.maxRetries}):`, lastError.message);
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error('Swap execution failed after all retries');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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