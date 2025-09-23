import {
  BlockData,
  TransactionData,
  EventProcessor,
  ActionData,
  DexV3BatchSubmit,
  DexV3Operation,
} from './types';
import { ArbitrageDetector, ArbitrageOpportunity } from '../strategies/arbitrage';
import { TriangularArbitrageDetector } from '../strategies/triangularArbitrage';
import { GSwapAPI } from '../api/gswap';
import { TradeExecutor } from '../trader/executor';
import { MockTradeExecutor } from '../mock/mockTradeExecutor';
import { config, getEnabledStrategyModes } from '../config';

export class RealTimeEventProcessor implements EventProcessor {
  private processedBlocks: Set<number> = new Set();
  private processedTransactions: Set<string> = new Set();
  private filteredBlocks = 0;
  private opportunitiesFound = 0;
  private tradesExecuted = 0;
  private readonly enabledStrategies = getEnabledStrategyModes();
  private readonly triangularDetector: TriangularArbitrageDetector;

  constructor(
    private api: GSwapAPI,
    private arbitrageDetector: ArbitrageDetector = new ArbitrageDetector(),
    private tradeExecutor: TradeExecutor = new TradeExecutor(api),
    private mockTradeExecutor: MockTradeExecutor = new MockTradeExecutor(),
    triangularDetector?: TriangularArbitrageDetector,
  ) {
    this.triangularDetector = triangularDetector ?? new TriangularArbitrageDetector();
  }

  async processBlock(blockData: BlockData): Promise<void> {
    try {
      if (blockData.channelName !== 'asset-channel') {
        this.filteredBlocks++;
        return;
      }

      const blockNumber = parseInt(blockData.blockNumber);

      if (this.processedBlocks.has(blockNumber)) {
        return;
      }

      this.processedBlocks.add(blockNumber);

      await this.maybeProcessTriangularArbitrage();

      for (const transaction of blockData.transactions) {
        await this.processTransaction(transaction);
      }
    } catch (error) {
      console.error('❌ Error processing block:', error);
    }
  }

  async processTransaction(txData: TransactionData): Promise<void> {
    try {
      if (this.processedTransactions.has(txData.id)) {
        return;
      }

      this.processedTransactions.add(txData.id);

      for (const action of txData.actions) {
        await this.processAction(action);
      }
    } catch (error) {
      console.error('❌ Error processing transaction:', error);
    }
  }

  private async processAction(action: ActionData): Promise<void> {
    try {
      if (!this.isBatchSubmitAction(action)) {
        return;
      }

      const batchSubmit: DexV3BatchSubmit = JSON.parse(action.args[1]);

      for (const operation of batchSubmit.operations) {
        if (operation.method !== 'Swap') {
          continue;
        }

        await this.processSwapOperation(operation);
      }
    } catch (error) {
      console.error('❌ Error processing action:', error);
    }
  }

  private async processSwapOperation(operation: DexV3Operation): Promise<void> {
    try {
      if (!this.enabledStrategies.includes('direct')) {
        return;
      }

      const opportunity = await this.arbitrageDetector.evaluateSwapOperation(operation, this.api);

      if (!opportunity) {
        return;
      }

      this.opportunitiesFound++;

      const executed = await this.executeOpportunity(opportunity);

      if (executed) {
        this.tradesExecuted++;
      }
    } catch (error) {
      console.error('❌ Error processing swap operation:', error);
    }
  }

  private isBatchSubmitAction(action: ActionData): boolean {
    return action.args.length >= 2 && action.args[0] === 'DexV3Contract:BatchSubmit';
  }

  private async executeOpportunity(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      if (config.mockMode) {
        return await this.mockTradeExecutor.executeArbitrageTrade(opportunity);
      }

      const execution = await this.tradeExecutor.executeArbitrage(opportunity);
      return execution.status === 'completed';
    } catch (error) {
      console.error('❌ Error executing arbitrage trade:', error);
      return false;
    }
  }

  private async maybeProcessTriangularArbitrage(): Promise<void> {
    if (!this.enabledStrategies.includes('triangular')) {
      return;
    }

    try {
      if (!this.tradeExecutor.canExecuteTrade()) {
        return;
      }

      const pairs = await this.api.getTradingPairs();
      if (pairs.length === 0) {
        return;
      }

      const quoteMap = this.api.getLatestQuoteMap();
      const opportunities = await this.triangularDetector.detectAllOpportunities(
        pairs,
        this.api,
        quoteMap,
      );

      if (opportunities.length === 0) {
        return;
      }

      for (const opportunity of opportunities) {
        this.opportunitiesFound++;

        if (!opportunity.hasFunds) {
          continue;
        }

        if (!this.tradeExecutor.canExecuteTrade()) {
          break;
        }

        const executed = await this.executeOpportunity(opportunity);

        if (executed) {
          this.tradesExecuted++;
        }
      }
    } catch (error) {
      console.error('❌ Error detecting triangular arbitrage opportunities:', error);
    }
  }

  getStats(): {
    blocksProcessed: number;
    blocksFiltered: number;
    opportunitiesFound: number;
    tradesExecuted: number;
    mockStats?: any;
  } {
    const stats: {
      blocksProcessed: number;
      blocksFiltered: number;
      opportunitiesFound: number;
      tradesExecuted: number;
      mockStats?: any;
    } = {
      blocksProcessed: this.processedBlocks.size,
      blocksFiltered: this.filteredBlocks,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
    };

    if (config.mockMode) {
      stats.mockStats = this.mockTradeExecutor.getStats();
    }

    return stats;
  }

  async generateMockReport(): Promise<void> {
    if (config.mockMode) {
      await this.mockTradeExecutor.generateFinalReport();
    }
  }

  clearProcessedData(): void {
    this.processedBlocks.clear();
    this.processedTransactions.clear();
    this.filteredBlocks = 0;
    this.opportunitiesFound = 0;
    this.tradesExecuted = 0;
  }
}
