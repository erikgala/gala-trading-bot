import { BlockData, SwapEvent, TransactionData, EventProcessor, ActionData, DexV3BatchSubmit } from './types';
import { GSwapAPI } from '../api/gswap';
import { ArbitrageDetector, ArbitrageOpportunity } from '../strategies/arbitrage';
import { TradeExecutor } from '../trader/executor';

export class RealTimeEventProcessor implements EventProcessor {
  private api: GSwapAPI;
  private detector: ArbitrageDetector;
  private executor: TradeExecutor;
  private processedBlocks: Set<number> = new Set();
  private processedSwaps: Set<string> = new Set();
  private filteredBlocks: number = 0;

  constructor(api: GSwapAPI, detector: ArbitrageDetector, executor: TradeExecutor) {
    this.api = api;
    this.detector = detector;
    this.executor = executor;
  }

  /**
   * Process incoming block data
   */
  async processBlock(blockData: BlockData): Promise<void> {
    try {
      // Skip blocks that aren't from asset-channel (only asset-channel has swap data)
      if (blockData.channelName !== 'asset-channel') {
        this.filteredBlocks++;
        console.log(`⏭️  Skipping block ${blockData.blockNumber} from channel: ${blockData.channelName} (${this.filteredBlocks} filtered)`);
        return;
      }

      // Avoid processing the same block twice
      if (this.processedBlocks.has(parseInt(blockData.blockNumber))) {
        return;
      }

      this.processedBlocks.add(parseInt(blockData.blockNumber));
      
      console.log(`📦 Processing asset-channel block ${blockData.blockNumber} at ${blockData.createdAt}`);
      console.log(`   Channel: ${blockData.channelName}`);
      console.log(`   Transactions: ${blockData.transactions.length}`);
      console.log(`   Previous hash: ${blockData.header.previous_hash}`);

      // Process each transaction for DexV3Contract:BatchSubmit
      for (const transaction of blockData.transactions) {
        await this.processTransaction(transaction);
      }

    } catch (error) {
      console.error('❌ Error processing block:', error);
    }
  }

  /**
   * Process swap events for real-time arbitrage detection
   */
  async processSwap(swapEvent: SwapEvent): Promise<void> {
    try {
      // Avoid processing the same swap twice
      if (this.processedSwaps.has(swapEvent.transactionId)) {
        return;
      }

      this.processedSwaps.add(swapEvent.transactionId);

      console.log(`🔄 Real-time swap detected:`);
      console.log(`   DEX: ${swapEvent.dex}`);
      console.log(`   Pair: ${swapEvent.tokenIn} -> ${swapEvent.tokenOut}`);
      console.log(`   Amount: ${swapEvent.amountIn} -> ${swapEvent.amountOut}`);
      console.log(`   Price Impact: ${swapEvent.priceImpact}%`);
      console.log(`   User: ${swapEvent.user}`);

      // Analyze for arbitrage opportunities
      await this.analyzeSwapForArbitrage(swapEvent);

    } catch (error) {
      console.error('❌ Error processing swap event:', error);
    }
  }

  /**
   * Process individual transactions
   */
  async processTransaction(txData: TransactionData): Promise<void> {
    try {
      console.log(`🔍 Analyzing transaction: ${txData.id}`);
      console.log(`   Creator: ${txData.creator.name} (${txData.creator.mspId})`);
      console.log(`   Type: ${txData.type}`);
      console.log(`   Validation: ${txData.validationCode.validationEnum}`);
      console.log(`   Actions: ${txData.actions.length}`);

      // Process each action for DexV3Contract:BatchSubmit
      for (const action of txData.actions) {
        await this.processAction(action, txData);
      }

    } catch (error) {
      console.error('❌ Error processing transaction:', error);
    }
  }

  /**
   * Process individual actions within transactions
   */
  private async processAction(action: ActionData, transaction: TransactionData): Promise<void> {
    try {
      // Check if this is a DexV3Contract:BatchSubmit operation
      if (action.args.length >= 2 && action.args[0] === 'DexV3Contract:BatchSubmit') {
        console.log(`🔄 Found DexV3Contract:BatchSubmit operation`);
        
        // Parse the batch submit payload
        const batchSubmit: DexV3BatchSubmit = JSON.parse(action.args[1]);
        console.log(`   Operations: ${batchSubmit.operations.length}`);
        console.log(`   Unique Key: ${batchSubmit.uniqueKey}`);

        // Process each swap operation
        for (const operation of batchSubmit.operations) {
          if (operation.method === 'Swap') {
            await this.processSwapOperation(operation, transaction);
          }
        }
      }

    } catch (error) {
      console.error('❌ Error processing action:', error);
    }
  }

  /**
   * Process individual swap operations
   */
  private async processSwapOperation(operation: any, transaction: TransactionData): Promise<void> {
    try {
      console.log(`🔄 Processing swap operation:`);
      console.log(`   Token0: ${operation.dto.token0.collection}`);
      console.log(`   Token1: ${operation.dto.token1.collection}`);
      console.log(`   Amount: ${operation.dto.amount}`);
      console.log(`   Fee: ${operation.dto.fee}`);
      console.log(`   ZeroForOne: ${operation.dto.zeroForOne}`);
      console.log(`   Recipient: ${operation.dto.recipient}`);

      // TODO: Implement sophisticated arbitrage detection
      // - Calculate price impact from sqrtPriceLimit
      // - Compare with historical prices
      // - Detect MEV opportunities
      // - Execute trades if profitable

    } catch (error) {
      console.error('❌ Error processing swap operation:', error);
    }
  }

  /**
   * Analyze a swap event for arbitrage opportunities
   */
  private async analyzeSwapForArbitrage(swapEvent: SwapEvent): Promise<void> {
    try {
      console.log(`🔍 Analyzing swap for arbitrage opportunities...`);

      // TODO: Implement real-time arbitrage detection
      // This is where we'll add the sophisticated logic once we have real data
      
      // Placeholder logic:
      // 1. Check if this swap created a price imbalance
      // 2. Look for cross-DEX arbitrage opportunities
      // 3. Detect MEV opportunities
      // 4. Execute trades if profitable

      console.log(`   Analysis complete for swap ${swapEvent.transactionId}`);

    } catch (error) {
      console.error('❌ Error analyzing swap for arbitrage:', error);
    }
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    blocksProcessed: number;
    blocksFiltered: number;
    swapsProcessed: number;
    opportunitiesFound: number;
    tradesExecuted: number;
  } {
    return {
      blocksProcessed: this.processedBlocks.size,
      blocksFiltered: this.filteredBlocks,
      swapsProcessed: this.processedSwaps.size,
      opportunitiesFound: 0, // TODO: Track actual opportunities
      tradesExecuted: 0, // TODO: Track actual trades
    };
  }

  /**
   * Clear processed data (for testing)
   */
  clearProcessedData(): void {
    this.processedBlocks.clear();
    this.processedSwaps.clear();
    this.filteredBlocks = 0;
  }
}
