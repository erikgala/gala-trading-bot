import { GSwapAPI, TradingPair, QuoteMap } from './api/gswap';
import { ArbitrageDetector, ArbitrageOpportunity, DirectArbitrageOpportunity } from './strategies/arbitrage';
import { TriangularArbitrageDetector } from './strategies/triangularArbitrage';
import { TradeExecutor } from './trader/executor';
import { config, validateConfig, getEnabledStrategyModes } from './config';
import { ensureMongoConnection } from './db/mongoClient';
import { GalaStreamingBot } from './streaming';

class GalaTradingBot {
  private api: GSwapAPI;
  private detector: ArbitrageDetector;
  private triangularDetector: TriangularArbitrageDetector;
  private executor: TradeExecutor;
  private isRunning: boolean = false;
  private pollingInterval?: NodeJS.Timeout;
  private readonly enabledStrategies = getEnabledStrategyModes();

  constructor() {
    this.api = new GSwapAPI();
    this.detector = new ArbitrageDetector();
    this.triangularDetector = new TriangularArbitrageDetector();
    this.executor = new TradeExecutor(this.api);
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Gala Trading Bot...');
      
      // Validate configuration
      validateConfig();
      console.log('✅ Configuration validated');

      // Verify MongoDB connectivity when configured
      await ensureMongoConnection();

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
      console.log(`🎯 Enabled strategies: ${this.enabledStrategies.join(', ')}`);
      
      if (config.mockMode) {
        console.log('🎭 Mock mode enabled - trades will be simulated');
        console.log(`📁 Mock run name: ${config.mockRunName}`);
        console.log('💰 Initial balances:', config.mockWalletBalances);
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
      const { pairs, quoteMap } = await this.fetchMarketData();
      console.log(`📊 Fetched ${pairs.length} trading pairs`);

      // Step 2: Detect arbitrage opportunities
      const opportunities = await this.detectArbitrageOpportunities(pairs, quoteMap);
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

  private async fetchMarketData(): Promise<{ pairs: TradingPair[]; quoteMap: QuoteMap }> {
    try {
      // Fetch trading pairs from gSwap
      const pairs = await this.api.getTradingPairs();
      const quoteMap = this.api.getLatestQuoteMap();
      return { pairs, quoteMap };
    } catch (error) {
      console.error('❌ Failed to fetch market data:', error);
      throw error;
    }
  }

  private async detectArbitrageOpportunities(
    pairs: TradingPair[],
    quoteMap: QuoteMap,
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    if (this.enabledStrategies.includes('direct')) {
      const directOpportunities = await this.detector.detectAllOpportunities(pairs, this.api, quoteMap);
      opportunities.push(...directOpportunities);
    }

    if (this.enabledStrategies.includes('triangular')) {
      const triangularOpportunities = await this.triangularDetector.detectAllOpportunities(
        pairs,
        this.api,
        quoteMap,
      );
      opportunities.push(...triangularOpportunities);
    }

    return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
  }


  private async executeOpportunities(opportunities: ArbitrageOpportunity[]): Promise<void> {
    const capacity = this.executor.getTradingCapacity();

    if (capacity.available <= 0) {
      console.log(`⏳ No available slots for new trades (${capacity.current}/${capacity.max})`);
      return;
    }

    const executableOpportunities = opportunities.filter(opp => opp.hasFunds);

    if (executableOpportunities.length === 0) {
      console.log('⏳ No executable opportunities (insufficient funds for all opportunities)');
      return;
    }

    const opportunitiesToExecute = executableOpportunities.slice(0, capacity.available);

    for (const opportunity of opportunitiesToExecute) {
      try {
        this.logOpportunityDetails(opportunity);

        this.executor.executeArbitrage(opportunity).catch(error => {
          console.error(`❌ Failed to execute opportunity ${opportunity.id}:`, error);
        });

      } catch (error) {
        console.error(`❌ Error executing opportunity ${opportunity.id}:`, error);
      }
    }
  }

  private checkFundWarnings(opportunities: ArbitrageOpportunity[]): void {
    const opportunitiesWithoutFunds = opportunities.filter(opp => !opp.hasFunds);

    if (opportunitiesWithoutFunds.length > 0) {
      console.log('\n⚠️  FUND WARNING: Opportunities found but insufficient funds!');
      console.log('   The following opportunities cannot be executed due to insufficient balance:');

      opportunitiesWithoutFunds.forEach(opp => {
        const tokenSymbol = this.getEntryTokenSymbol(opp);
        console.log(`   💰 ${this.formatOpportunityPath(opp)}: ${opp.profitPercentage.toFixed(2)}% profit`);
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

  private logOpportunityDetails(opportunity: ArbitrageOpportunity): void {
    const entrySymbol = this.getEntryTokenSymbol(opportunity);

    console.log(`\n💰 Executing ${opportunity.strategy} opportunity: ${this.formatOpportunityPath(opportunity)}`);

    if (this.isDirectOpportunity(opportunity)) {
      console.log(`   Buy: ${opportunity.tokenClassA} @ ${opportunity.buyPrice.toFixed(6)}`);
      console.log(`   Sell: ${opportunity.tokenClassB} @ ${opportunity.sellPrice.toFixed(6)}`);
    } else {
      opportunity.path.forEach((leg, index) => {
        console.log(
          `   Leg ${index + 1}: ${leg.fromSymbol} (${leg.fromTokenClass}) -> ${leg.toSymbol} (${leg.toTokenClass})`,
        );
      });
    }

    console.log(`   Expected profit: ${opportunity.profitPercentage.toFixed(2)}%`);
    console.log(`   Trade amount: ${opportunity.maxTradeAmount}`);
    console.log(`   Balance: ${opportunity.currentBalance.toFixed(2)} ${entrySymbol}`);
  }

  private isDirectOpportunity(
    opportunity: ArbitrageOpportunity,
  ): opportunity is DirectArbitrageOpportunity {
    return opportunity.strategy === 'direct';
  }

  private formatOpportunityPath(opportunity: ArbitrageOpportunity): string {
    if (this.isDirectOpportunity(opportunity)) {
      return `${opportunity.tokenA} -> ${opportunity.tokenB} -> ${opportunity.tokenA}`;
    }

    const symbols = [opportunity.entryTokenSymbol, ...opportunity.path.map(leg => leg.toSymbol)];
    return symbols.join(' -> ');
  }

  private getEntryTokenSymbol(opportunity: ArbitrageOpportunity): string {
    return this.isDirectOpportunity(opportunity)
      ? opportunity.tokenA
      : opportunity.entryTokenSymbol;
  }

  private logTradingStats(): void {
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
        console.log(
          `     ${trade.id}: ${trade.status} (${this.formatOpportunityPath(trade.opportunity)})`,
        );
      });
    }
  }
}

interface BotLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function registerLifecycleHandlers(bot: BotLifecycle, options?: { onStop?: () => void }): void {
  let shuttingDown = false;

  const shutdown = async (code: number) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    try {
      await bot.stop();
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    } finally {
      options?.onStop?.();
      process.exit(code);
    }
  };

  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    void shutdown(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    void shutdown(0);
  });

  process.on('uncaughtException', error => {
    console.error('❌ Uncaught Exception:', error);
    void shutdown(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    void shutdown(1);
  });
}

async function runPollingMode(): Promise<void> {
  const bot = new GalaTradingBot();
  registerLifecycleHandlers(bot);
  await bot.start();
}

async function runStreamingMode(): Promise<void> {
  const bot = new GalaStreamingBot();
  let statusInterval: NodeJS.Timeout | undefined;

  registerLifecycleHandlers(bot, {
    onStop: () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    },
  });

  await bot.start();

  statusInterval = setInterval(() => {
    bot.logStatus();
  }, 30000);
}

async function main() {
  if (config.mode === 'streaming') {
    await runStreamingMode();
  } else {
    await runPollingMode();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { GalaTradingBot };
