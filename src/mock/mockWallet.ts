import { config } from '../config';

export interface MockTransaction {
  id: string;
  timestamp: number;
  type: 'swap' | 'arbitrage';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  price: number;
  profit?: number;
  balances: Record<string, number>;
}

export class MockWallet {
  private balances: Record<string, number>;
  private transactions: MockTransaction[] = [];
  private runName: string;

  constructor(initialBalances: Record<string, number>, runName: string) {
    this.balances = { ...initialBalances };
    this.runName = runName;
  }

  /**
   * Get current balance for a token
   */
  getBalance(tokenClass: string): number {
    return this.balances[tokenClass] || 0;
  }

  /**
   * Get all current balances
   */
  getAllBalances(): Record<string, number> {
    return { ...this.balances };
  }

  /**
   * Check if wallet has sufficient balance for a trade
   */
  hasSufficientBalance(tokenClass: string, amount: number): boolean {
    return this.getBalance(tokenClass) >= amount;
  }

  /**
   * Execute a mock swap
   */
  executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    amountOut: number,
    price: number,
    type: 'swap' | 'arbitrage' = 'swap',
    profit?: number
  ): MockTransaction {
    // Check if we have sufficient balance
    if (!this.hasSufficientBalance(tokenIn, amountIn)) {
      throw new Error(`Insufficient balance for ${tokenIn}. Required: ${amountIn}, Available: ${this.getBalance(tokenIn)}`);
    }

    // Update balances
    this.balances[tokenIn] -= amountIn;
    this.balances[tokenOut] = (this.balances[tokenOut] || 0) + amountOut;

    // Create transaction record
    const transaction: MockTransaction = {
      id: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      price,
      profit,
      balances: { ...this.balances }
    };

    this.transactions.push(transaction);

    console.log(`💰 MOCK ${type.toUpperCase()} EXECUTED:`);
    console.log(`   ${amountIn.toFixed(6)} ${tokenIn} -> ${amountOut.toFixed(6)} ${tokenOut}`);
    console.log(`   Price: ${price.toFixed(6)}`);
    if (profit) {
      console.log(`   Profit: ${profit.toFixed(6)}`);
    }
    console.log(`   New Balances:`, this.balances);

    return transaction;
  }

  /**
   * Get all transactions
   */
  getTransactions(): MockTransaction[] {
    return [...this.transactions];
  }

  /**
   * Get run name
   */
  getRunName(): string {
    return this.runName;
  }

  /**
   * Get total profit from arbitrage trades
   */
  getTotalProfit(): number {
    return this.transactions
      .filter(tx => tx.type === 'arbitrage' && tx.profit)
      .reduce((total, tx) => total + (tx.profit || 0), 0);
  }

  /**
   * Get transaction count by type
   */
  getTransactionStats(): { total: number; swaps: number; arbitrage: number } {
    const swaps = this.transactions.filter(tx => tx.type === 'swap').length;
    const arbitrage = this.transactions.filter(tx => tx.type === 'arbitrage').length;
    
    return {
      total: this.transactions.length,
      swaps,
      arbitrage
    };
  }
}
