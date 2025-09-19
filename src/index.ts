import { GSwapAPI, TradingPair } from './api/gswap';
import { ArbitrageDetector, ArbitrageOpportunity } from './strategies/arbitrage';
import { TradeExecutor } from './trader/executor';
import { MockTradeExecutor } from './mock/mockTradeExecutor';
import { config, validateConfig } from './config';

class GalaTradingBot {
  private api: GSwapAPI;
  private detector: ArbitrageDetector;
  private executor: TradeExecutor;
  private mockExecutor: MockTradeExecutor;
  private isRunning: boolean = false;
  private pollingInterval?: NodeJS.Timeout;

  constructor() {
    this.api = new GSwapAPI();
    this.detector = new ArbitrageDetector();
    this.executor = new TradeExecutor(this.api);
    this.mockExecutor = new MockTradeExecutor();
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Gala Trading Bot...');
      
      // Validate configuration
      validateConfig();
      console.log('✅ Configuration validated');

      // Test API connection
      await this.testApiConnection();
      console.log('✅ API connection established');

      // Start the main trading loop
      this.isRunning = true;
      this.startTradingLoop();
      
      console.log('✅ Trading bot started successfully');
      console.log(`📊 Polling interval: ${config.pollingInterval}ms`);
      console.log(`💰 Min profit threshold: ${config.minProfitThreshold}%`);
      console.log(`💵 Max trade amount: ${config.maxTradeAmount}`);
      
      if (config.mockMode) {
        console.log('🎭 Mock mode enabled - trades will be simulated');
        console.log(`📁 Mock run name: ${config.mockRunName}`);
        console.log(`💰 Initial balances:`, this.mockExecutor.getBalances());
      }

    } catch (error) {
      console.error('❌ Failed to start trading bot:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Gala Trading Bot...');
    
    this.isRunning = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Generate mock trading report if in mock mode
    if (config.mockMode) {
      this.mockExecutor.generateFinalReport();
    }

    // Cancel all active trades
    const activeTrades = this.executor.getActiveTrades();
    for (const trade of activeTrades) {
      if (trade.status === 'pending' || trade.status === 'buying' || trade.status === 'selling') {
        await this.executor.cancelTradeExecution(trade.id);
      }
    }

    console.log('✅ Trading bot stopped');
  }

  private async testApiConnection(): Promise<void> {
    try {
      const connected = await this.api.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to gSwap');
      }
      
      const tokens = await this.api.getAvailableTokens();
      console.log(`📈 Found ${tokens.length} available tokens`);
      
      const pairs = await this.api.getTradingPairs();
      console.log(`🔄 Found ${pairs.length} trading pairs`);
    } catch (error) {
      throw new Error(`gSwap connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private startTradingLoop(): void {
    this.pollingInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.tradingCycle();
      } catch (error) {
        console.error('❌ Error in trading cycle:', error);
      }
    }, config.pollingInterval);
  }

  private async tradingCycle(): Promise<void> {
    const startTime = Date.now();
    console.log(`\n🔄 Starting trading cycle at ${new Date().toISOString()}`);

    try {
      // Step 1: Fetch market data
      const pairs = await this.fetchMarketData();
      console.log(`📊 Fetched ${pairs.length} trading pairs`);

      // Step 2: Detect arbitrage opportunities
      const opportunities = await this.detector.detectAllOpportunities(pairs, this.api);
      console.log(`🔍 Found ${opportunities.length} arbitrage opportunities`);

      // Step 2.5: Check for opportunities without sufficient funds
      this.checkFundWarnings(opportunities);

      // Step 3: Execute profitable opportunities
      if (opportunities.length > 0) {
        await this.executeOpportunities(opportunities);
      }

      // Step 4: Log statistics
      this.logTradingStats();

      const cycleTime = Date.now() - startTime;
      console.log(`⏱️  Trading cycle completed in ${cycleTime}ms`);

    } catch (error) {
      console.error('❌ Trading cycle failed:', error);
    }
  }

  private async fetchMarketData(): Promise<TradingPair[]> {
    try {
      // Fetch trading pairs from gSwap
      const pairs = await this.api.getTradingPairs();
      return pairs;
    } catch (error) {
      console.error('❌ Failed to fetch market data:', error);
      throw error;
    }
  }


  private async executeOpportunities(opportunities: ArbitrageOpportunity[]): Promise<void> {
    if (config.mockMode) {
      // Mock mode execution
      const executableOpportunities = opportunities.filter(opp => opp.hasFunds);
      
      if (executableOpportunities.length === 0) {
        console.log('⏳ No executable opportunities (insufficient funds for all opportunities)');
        return;
      }

      // Execute the most profitable opportunities (limit to 3 for mock mode)
      const opportunitiesToExecute = executableOpportunities.slice(0, 3);
      
      for (const opportunity of opportunitiesToExecute) {
        try {
          console.log(`\n💰 Executing mock opportunity: ${opportunity.tokenA} -> ${opportunity.tokenB}`);
          console.log(`   Buy: ${opportunity.tokenClassA} @ ${opportunity.buyPrice.toFixed(6)}`);
          console.log(`   Sell: ${opportunity.tokenClassB} @ ${opportunity.sellPrice.toFixed(6)}`);
          console.log(`   Expected profit: ${opportunity.profitPercentage.toFixed(2)}%`);
          console.log(`   Trade amount: ${opportunity.maxTradeAmount}`);
          console.log(`   Balance: ${opportunity.currentBalance.toFixed(2)} ${opportunity.tokenClassA.split('|')[0]}`);
          
          // Execute mock trade
          const success = await this.mockExecutor.executeArbitrageTrade(opportunity);
          if (success) {
            console.log(`✅ Mock trade executed successfully`);
          }
          
        } catch (error) {
          console.error(`❌ Error executing mock opportunity ${opportunity.id}:`, error);
        }
      }
    } else {
      // Real mode execution
      const capacity = this.executor.getTradingCapacity();
      
      if (capacity.available <= 0) {
        console.log(`⏳ No available slots for new trades (${capacity.current}/${capacity.max})`);
        return;
      }

      // Filter opportunities that have sufficient funds
      const executableOpportunities = opportunities.filter(opp => opp.hasFunds);
      
      if (executableOpportunities.length === 0) {
        console.log('⏳ No executable opportunities (insufficient funds for all opportunities)');
        return;
      }

      // Execute the most profitable opportunities with sufficient funds
      const opportunitiesToExecute = executableOpportunities.slice(0, capacity.available);
      
      for (const opportunity of opportunitiesToExecute) {
        try {
          console.log(`\n💰 Executing opportunity: ${opportunity.tokenA} -> ${opportunity.tokenB}`);
          console.log(`   Buy: ${opportunity.tokenClassA} @ ${opportunity.buyPrice.toFixed(6)}`);
          console.log(`   Sell: ${opportunity.tokenClassB} @ ${opportunity.sellPrice.toFixed(6)}`);
          console.log(`   Expected profit: ${opportunity.profitPercentage.toFixed(2)}%`);
          console.log(`   Trade amount: ${opportunity.maxTradeAmount}`);
          console.log(`   Balance: ${opportunity.currentBalance.toFixed(2)} ${opportunity.tokenClassA.split('|')[0]}`);
          
          // Execute in background to avoid blocking
          this.executor.executeArbitrage(opportunity).catch(error => {
            console.error(`❌ Failed to execute opportunity ${opportunity.id}:`, error);
          });
          
        } catch (error) {
          console.error(`❌ Error executing opportunity ${opportunity.id}:`, error);
        }
      }
    }
  }

  private checkFundWarnings(opportunities: ArbitrageOpportunity[]): void {
    const opportunitiesWithoutFunds = opportunities.filter(opp => !opp.hasFunds);
    
    if (opportunitiesWithoutFunds.length > 0) {
      console.log('\n⚠️  FUND WARNING: Opportunities found but insufficient funds!');
      console.log('   The following opportunities cannot be executed due to insufficient balance:');
      
      opportunitiesWithoutFunds.forEach(opp => {
        const tokenSymbol = opp.tokenClassA.split('|')[0];
        console.log(`   💰 ${opp.tokenA} -> ${opp.tokenB}: ${opp.profitPercentage.toFixed(2)}% profit`);
        console.log(`      Required: ${opp.maxTradeAmount.toFixed(2)} ${tokenSymbol}`);
        console.log(`      Available: ${opp.currentBalance.toFixed(2)} ${tokenSymbol}`);
        console.log(`      Shortfall: ${opp.shortfall.toFixed(2)} ${tokenSymbol}`);
        console.log(`      Potential profit: ${opp.estimatedProfit.toFixed(2)}`);
        console.log('');
      });
      
      console.log('   💡 To execute these trades, you need to:');
      console.log('      1. Add more tokens to your wallet');
      console.log('      2. Reduce MAX_TRADE_AMOUNT in your configuration');
      console.log('      3. Wait for smaller opportunities that match your balance');
      console.log('');
    }
  }

  private logTradingStats(): void {
    if (config.mockMode) {
      // Mock mode statistics
      const mockStats = this.mockExecutor.getStats();
      const balances = this.mockExecutor.getBalances();
      
      console.log('\n🎭 Mock Trading Statistics:');
      console.log(`   Total transactions: ${mockStats.totalTransactions}`);
      console.log(`   Arbitrage trades: ${mockStats.arbitrageTrades}`);
      console.log(`   Swap trades: ${mockStats.swapTrades}`);
      console.log(`   Total profit: ${mockStats.totalProfit.toFixed(6)}`);
      console.log(`   Success rate: ${mockStats.successRate.toFixed(2)}%`);
      
      console.log('\n💰 Current Balances:');
      Object.entries(balances).forEach(([token, balance]) => {
        const symbol = token.split('|')[0];
        console.log(`   ${symbol}: ${balance.toFixed(6)}`);
      });
    } else {
      // Real mode statistics
      const stats = this.executor.getTradingStats();
      const activeTrades = this.executor.getActiveTrades();
      
      console.log('\n📊 Trading Statistics:');
      console.log(`   Total trades: ${stats.totalTrades}`);
      console.log(`   Completed: ${stats.completedTrades}`);
      console.log(`   Failed: ${stats.failedTrades}`);
      console.log(`   Success rate: ${stats.successRate.toFixed(1)}%`);
      console.log(`   Total profit: ${stats.totalProfit.toFixed(2)}`);
      console.log(`   Average profit: ${stats.averageProfit.toFixed(2)}`);
      console.log(`   Active trades: ${activeTrades.length}`);
      
      if (activeTrades.length > 0) {
        console.log('   Active trade statuses:');
        activeTrades.forEach(trade => {
          console.log(`     ${trade.id}: ${trade.status} (${trade.opportunity.tokenA} -> ${trade.opportunity.tokenB})`);
        });
      }
    }
  }
}

// Main execution
async function main() {
  const bot = new GalaTradingBot();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);
    await bot.stop();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    await bot.stop();
    process.exit(1);
  });

  // Start the bot
  await bot.start();
}

// Run the bot
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { GalaTradingBot };
