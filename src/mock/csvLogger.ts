import * as fs from 'fs';
import * as path from 'path';
import { MockTransaction } from './mockWallet';

export class MockCSVLogger {
  private filePath: string;
  private headersWritten: boolean = false;

  constructor(runName: string) {
    // Create mock_runs directory if it doesn't exist
    const mockRunsDir = path.join(process.cwd(), 'mock_runs');
    if (!fs.existsSync(mockRunsDir)) {
      fs.mkdirSync(mockRunsDir, { recursive: true });
    }

    this.filePath = path.join(mockRunsDir, `${runName}.csv`);
    console.log(`📊 Mock CSV Logger initialized: ${this.filePath}`);
  }

  /**
   * Log a transaction to CSV
   */
  logTransaction(transaction: MockTransaction): void {
    try {
      // Write headers if this is the first transaction
      if (!this.headersWritten) {
        this.writeHeaders();
        this.headersWritten = true;
      }

      // Prepare CSV row
      const row = this.formatTransactionAsCSV(transaction);
      
      // Append to file
      fs.appendFileSync(this.filePath, row + '\n');
      
    } catch (error) {
      console.error('❌ Error logging transaction to CSV:', error);
    }
  }

  /**
   * Write CSV headers
   */
  private writeHeaders(): void {
    const headers = [
      'timestamp',
      'id',
      'type',
      'token_in',
      'token_out',
      'amount_in',
      'amount_out',
      'price',
      'profit',
      'balance_gala',
      'balance_gusdc',
      'balance_gusdt',
      'balance_gweth',
      'balance_gwbtc',
      'balance_other'
    ];

    const headerRow = headers.join(',');
    fs.writeFileSync(this.filePath, headerRow + '\n');
  }

  /**
   * Format transaction as CSV row
   */
  private formatTransactionAsCSV(transaction: MockTransaction): string {
    const timestamp = new Date(transaction.timestamp).toISOString();
    const profit = transaction.profit || '';
    
    // Extract common token balances
    const balances = transaction.balances;
    const galaBalance = balances['GALA|Unit|none|none'] || 0;
    const gusdcBalance = balances['GUSDC|Unit|none|none'] || 0;
    const gusdtBalance = balances['GUSDT|Unit|none|none'] || 0;
    const gwethBalance = balances['GWETH|Unit|none|none'] || 0;
    const gwbtcBalance = balances['GWBTC|Unit|none|none'] || 0;
    
    // Calculate other tokens balance
    const otherBalance = Object.entries(balances)
      .filter(([key]) => !['GALA|Unit|none|none', 'GUSDC|Unit|none|none', 'GUSDT|Unit|none|none', 'GWETH|Unit|none|none', 'GWBTC|Unit|none|none'].includes(key))
      .reduce((sum, [, value]) => sum + value, 0);

    return [
      timestamp,
      transaction.id,
      transaction.type,
      transaction.tokenIn,
      transaction.tokenOut,
      transaction.amountIn.toFixed(6),
      transaction.amountOut.toFixed(6),
      transaction.price.toFixed(6),
      profit,
      galaBalance.toFixed(6),
      gusdcBalance.toFixed(6),
      gusdtBalance.toFixed(6),
      gwethBalance.toFixed(6),
      gwbtcBalance.toFixed(6),
      otherBalance.toFixed(6)
    ].join(',');
  }

  /**
   * Get file path
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Create summary report
   */
  createSummaryReport(transactions: MockTransaction[]): void {
    try {
      const summaryPath = this.filePath.replace('.csv', '_summary.txt');
      
      const stats = this.calculateStats(transactions);
      const summary = this.formatSummary(stats, transactions);
      
      fs.writeFileSync(summaryPath, summary);
      console.log(`📊 Summary report created: ${summaryPath}`);
      
    } catch (error) {
      console.error('❌ Error creating summary report:', error);
    }
  }

  /**
   * Calculate transaction statistics
   */
  private calculateStats(transactions: MockTransaction[]): any {
    const arbitrageTxs = transactions.filter(tx => tx.type === 'arbitrage');
    const swapTxs = transactions.filter(tx => tx.type === 'swap');
    
    const totalProfit = arbitrageTxs.reduce((sum, tx) => sum + (tx.profit || 0), 0);
    const totalVolume = transactions.reduce((sum, tx) => sum + tx.amountIn, 0);
    
    return {
      totalTransactions: transactions.length,
      arbitrageTransactions: arbitrageTxs.length,
      swapTransactions: swapTxs.length,
      totalProfit,
      totalVolume,
      averageProfit: arbitrageTxs.length > 0 ? totalProfit / arbitrageTxs.length : 0,
      successRate: arbitrageTxs.length > 0 ? (arbitrageTxs.filter(tx => (tx.profit || 0) > 0).length / arbitrageTxs.length) * 100 : 0
    };
  }

  /**
   * Format summary report
   */
  private formatSummary(stats: any, transactions: MockTransaction[]): string {
    const startTime = transactions.length > 0 ? new Date(transactions[0].timestamp) : new Date();
    const endTime = transactions.length > 0 ? new Date(transactions[transactions.length - 1].timestamp) : new Date();
    const duration = endTime.getTime() - startTime.getTime();
    
    return `
Mock Trading Summary Report
==========================
Run Name: ${this.filePath.split('/').pop()?.replace('.csv', '')}
Start Time: ${startTime.toISOString()}
End Time: ${endTime.toISOString()}
Duration: ${Math.round(duration / 1000)} seconds

Transaction Statistics:
- Total Transactions: ${stats.totalTransactions}
- Arbitrage Trades: ${stats.arbitrageTransactions}
- Regular Swaps: ${stats.swapTransactions}
- Total Volume: ${stats.totalVolume.toFixed(6)}
- Total Profit: ${stats.totalProfit.toFixed(6)}
- Average Profit per Arbitrage: ${stats.averageProfit.toFixed(6)}
- Success Rate: ${stats.successRate.toFixed(2)}%

Final Balances:
${Object.entries(transactions[transactions.length - 1]?.balances || {})
  .map(([token, balance]) => `- ${token}: ${balance.toFixed(6)}`)
  .join('\n')}
`;
  }
}
