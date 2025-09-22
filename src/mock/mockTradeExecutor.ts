import { ArbitrageOpportunity } from '../strategies/arbitrage';
import { MockWallet } from './mockWallet';
import { MockCSVLogger } from './csvLogger';
import { config } from '../config';

export class MockTradeExecutor {
  private mockWallet?: MockWallet;
  private csvLogger?: MockCSVLogger;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = config.mockMode;
    
    if (this.isEnabled) {
      this.mockWallet = new MockWallet(config.mockWalletBalances, config.mockRunName);
      this.csvLogger = new MockCSVLogger(config.mockRunName);
      
      console.log('🎭 Mock Trade Executor initialized');
      console.log(`   Run Name: ${config.mockRunName}`);
      console.log(`   Initial Balances:`, this.mockWallet.getAllBalances());
    }
  }

  /**
   * Execute a mock arbitrage trade
   */
  async executeArbitrageTrade(opportunity: ArbitrageOpportunity): Promise<boolean> {
    if (!this.isEnabled || !this.mockWallet || !this.csvLogger) {
      console.log('⚠️  Mock mode disabled, skipping trade execution');
      return false;
    }

    try {
      // Check if we have sufficient balance
      if (!this.mockWallet.hasSufficientBalance(opportunity.tokenClassA, opportunity.maxTradeAmount)) {
        console.log(`❌ Insufficient balance for arbitrage trade`);
        console.log(`   Required: ${opportunity.maxTradeAmount} ${opportunity.tokenA}`);
        console.log(`   Available: ${this.mockWallet.getBalance(opportunity.tokenClassA)} ${opportunity.tokenA}`);
        return false;
      }

      // Calculate actual trade amounts based on quotes
      const amountIn = opportunity.maxTradeAmount;
      const amountOut = opportunity.quoteAToB.outputAmount;
      
      // Calculate profit (simplified - in reality this would be more complex)
      const profit = opportunity.estimatedProfit;

      // Execute the mock trade
      const transaction = this.mockWallet.executeSwap(
        opportunity.tokenClassA,
        opportunity.tokenClassB,
        amountIn,
        amountOut,
        opportunity.buyPrice,
        'arbitrage',
        profit
      );

      // Log to CSV
      this.csvLogger.logTransaction(transaction);

      console.log(`✅ Mock arbitrage trade executed successfully`);
      console.log(`   Transaction ID: ${transaction.id}`);
      console.log(`   Profit: ${profit?.toFixed(6)}`);

      return true;

    } catch (error) {
      console.error('❌ Error executing mock arbitrage trade:', error);
      return false;
    }
  }

  /**
   * Get current wallet balances
   */
  getBalances(): Record<string, number> {
    if (!this.isEnabled || !this.mockWallet) {
      return {};
    }
    return this.mockWallet.getAllBalances();
  }

  /**
   * Get wallet balance for a specific token
   */
  getBalance(tokenClass: string): number {
    if (!this.isEnabled || !this.mockWallet) {
      return 0;
    }
    return this.mockWallet.getBalance(tokenClass);
  }

  /**
   * Get transaction statistics
   */
  getStats(): {
    totalTransactions: number;
    arbitrageTrades: number;
    swapTrades: number;
    totalProfit: number;
    successRate: number;
  } {
    if (!this.isEnabled || !this.mockWallet) {
      return {
        totalTransactions: 0,
        arbitrageTrades: 0,
        swapTrades: 0,
        totalProfit: 0,
        successRate: 0
      };
    }

    const transactions = this.mockWallet.getTransactions();
    const stats = this.mockWallet.getTransactionStats();
    const totalProfit = this.mockWallet.getTotalProfit();
    
    const arbitrageTxs = transactions.filter(tx => tx.type === 'arbitrage');
    const successfulArbitrage = arbitrageTxs.filter(tx => (tx.profit || 0) > 0).length;
    const successRate = arbitrageTxs.length > 0 ? (successfulArbitrage / arbitrageTxs.length) * 100 : 0;

    return {
      totalTransactions: stats.total,
      arbitrageTrades: stats.arbitrage,
      swapTrades: stats.swaps,
      totalProfit,
      successRate
    };
  }

  /**
   * Generate final report
   */
  generateFinalReport(): void {
    if (!this.isEnabled || !this.mockWallet || !this.csvLogger) {
      return;
    }

    const transactions = this.mockWallet.getTransactions();
    this.csvLogger.createSummaryReport(transactions);
    
    console.log('\n📊 Mock Trading Session Complete');
    console.log('================================');
    console.log(`CSV File: ${this.csvLogger.getFilePath()}`);
    console.log(`Summary: ${this.csvLogger.getFilePath().replace('.csv', '_summary.txt')}`);
    
    const stats = this.getStats();
    console.log(`\nFinal Statistics:`);
    console.log(`- Total Transactions: ${stats.totalTransactions}`);
    console.log(`- Arbitrage Trades: ${stats.arbitrageTrades}`);
    console.log(`- Swap Trades: ${stats.swapTrades}`);
    console.log(`- Total Profit: ${stats.totalProfit.toFixed(6)}`);
    console.log(`- Success Rate: ${stats.successRate.toFixed(2)}%`);
    
    console.log(`\nFinal Balances:`);
    Object.entries(this.getBalances()).forEach(([token, balance]) => {
      console.log(`- ${token}: ${balance.toFixed(6)}`);
    });
  }

  /**
   * Check if mock mode is enabled
   */
  isMockModeEnabled(): boolean {
    return this.isEnabled;
  }
}
