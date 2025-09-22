import { BlockData, TransactionData, EventProcessor, ActionData, DexV3BatchSubmit } from './types';
import { ArbitrageDetector, ArbitrageOpportunity } from '../strategies/arbitrage';
import { GSwapAPI } from '../api/gswap';
import { TradeExecutor } from '../trader/executor';
import { MockTradeExecutor } from '../mock/mockTradeExecutor';
import { config } from '../config';

export class RealTimeEventProcessor implements EventProcessor {
  private processedBlocks: Set<number> = new Set();
  private processedTransactions: Set<string> = new Set();
  private filteredBlocks: number = 0;
  private opportunitiesFound: number = 0;
  private tradesExecuted: number = 0;
  private arbitrageDetector: ArbitrageDetector;
  private api: GSwapAPI;
  private tradeExecutor: TradeExecutor;
  private mockTradeExecutor: MockTradeExecutor;

  constructor(api: GSwapAPI) {
    this.api = api;
    this.arbitrageDetector = new ArbitrageDetector();
    this.tradeExecutor = new TradeExecutor(api);
    this.mockTradeExecutor = new MockTradeExecutor();
  }

  /**
   * Process incoming block data
   */
  async processBlock(blockData: BlockData): Promise<void> {
    try {
      // Skip blocks that aren't from asset-channel (only asset-channel has swap data)
      if (blockData.channelName !== 'asset-channel') {
        this.filteredBlocks++;
        return;
      }

      // Avoid processing the same block twice
      if (this.processedBlocks.has(parseInt(blockData.blockNumber))) {
        return;
      }

      this.processedBlocks.add(parseInt(blockData.blockNumber));

      // Process each transaction for DexV3Contract:BatchSubmit
      for (const transaction of blockData.transactions) {
        await this.processTransaction(transaction);
      }

    } catch (error) {
      console.error('❌ Error processing block:', error);
    }
  }


  /**
   * Process individual transactions
   */
  async processTransaction(txData: TransactionData): Promise<void> {
    try {
      // Avoid processing the same transaction twice
      if (this.processedTransactions.has(txData.id)) {
        return;
      }

      this.processedTransactions.add(txData.id);

      // Process each action for DexV3Contract:BatchSubmit
      for (const action of txData.actions) {
        await this.processAction(action);
      }

    } catch (error) {
      console.error('❌ Error processing transaction:', error);
    }
  }

  /**
   * Process individual actions within transactions
   */
  private async processAction(action: ActionData): Promise<void> {
    try {
      // Check if this is a DexV3Contract:BatchSubmit operation
      if (action.args.length >= 2 && action.args[0] === 'DexV3Contract:BatchSubmit') {
        // Parse the batch submit payload
        const batchSubmit: DexV3BatchSubmit = JSON.parse(action.args[1]);

        // Process each swap operation
        for (const operation of batchSubmit.operations) {
          if (operation.method === 'Swap') {
            await this.processSwapOperation(operation);
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
  private async processSwapOperation(operation: any): Promise<void> {
    try {
      // Extract swap details
      const swapData = {
        tokenIn: operation.dto.zeroForOne ? operation.dto.token0 : operation.dto.token1,
        tokenOut: operation.dto.zeroForOne ? operation.dto.token1 : operation.dto.token0,
        amountIn: operation.dto.amount,
        amountInMaximum: operation.dto.amountInMaximum,
        fee: operation.dto.fee,
        sqrtPriceLimit: operation.dto.sqrtPriceLimit,
        recipient: operation.dto.recipient,
        signature: operation.dto.signature,
        uniqueKey: operation.dto.uniqueKey,
        method: operation.method,
        uniqueId: operation.uniqueId
      };

      // Validate tokens against known GalaSwap tokens using token class keys
      const tokenInClassKey = this.api.createTokenClassKey(swapData.tokenIn);
      const tokenOutClassKey = this.api.createTokenClassKey(swapData.tokenOut);
      
      if (!this.api.isTokenAvailableByClassKey(tokenInClassKey) || !this.api.isTokenAvailableByClassKey(tokenOutClassKey)) {
        // Skip processing if tokens are not available on GalaSwap
        return;
      }

      // Only process arbitrage opportunities involving GALA tokens
      const GALA_TOKEN_CLASS = 'GALA|Unit|none|none';
      if (tokenInClassKey !== GALA_TOKEN_CLASS && tokenOutClassKey !== GALA_TOKEN_CLASS) {
        // Skip processing if neither token is GALA
        return;
      }

      // Calculate current price from swap amounts (more accurate than sqrtPriceLimit)
      const currentPrice = this.calculatePriceFromSwapAmounts(swapData);

      // Analyze for arbitrage opportunities using the sophisticated strategies
      const arbitrageOpportunities = await this.detectArbitrageOpportunities(swapData, currentPrice);
      
      if (arbitrageOpportunities.length > 0) {
        // Take the best opportunity
        const bestOpportunity = arbitrageOpportunities[0];
        this.opportunitiesFound++;
        
        console.log(`💰 ARBITRAGE OPPORTUNITY DETECTED! (#${this.opportunitiesFound})`);
        console.log(`   Strategy: ${bestOpportunity.tokenA} -> ${bestOpportunity.tokenB}`);
        console.log(`   Expected Profit: ${bestOpportunity.profitPercentage.toFixed(2)}%`);
        console.log(`   Current Market Price: ${currentPrice.toFixed(6)}`);
        console.log(`   Price Discrepancy: ${bestOpportunity.priceDiscrepancy?.toFixed(2) || 'N/A'}%`);
        console.log(`   Confidence Score: ${bestOpportunity.confidence?.toFixed(2) || 'N/A'}`);
        console.log(`   Estimated Profit: ${bestOpportunity.estimatedProfit.toFixed(2)}`);
        console.log(`   Max Trade Amount: ${bestOpportunity.maxTradeAmount}`);
        console.log(`   Has Funds: ${bestOpportunity.hasFunds}`);
        
        if (bestOpportunity.hasFunds) {
          console.log(`✅ Sufficient funds available for arbitrage trade`);

          await this.executeArbitrageTrade(bestOpportunity, swapData);
        } else {
          console.log(`⚠️  Insufficient funds for arbitrage trade`);
          console.log(`   Required: ${bestOpportunity.maxTradeAmount}`);
          console.log(`   Available: ${bestOpportunity.currentBalance}`);
          console.log(`   Shortfall: ${bestOpportunity.shortfall}`);
        }
      }

    } catch (error) {
      console.error('❌ Error processing swap operation:', error);
    }
  }


  /**
   * Calculate price from swap amounts (more accurate than sqrtPriceLimit)
   */
  private calculatePriceFromSwapAmounts(swapData: any): number {
    try {
      const amountIn = parseFloat(swapData.amountIn);
      const amountInMaximum = parseFloat(swapData.amountInMaximum);
      
      // If we have both amounts, calculate the effective price
      // The price is typically amountOut / amountIn, but we need to estimate amountOut
      // For now, let's use amountInMaximum as a proxy for the expected output
      if (amountIn > 0 && amountInMaximum > 0) {
        // This is an approximation - in reality we'd need the actual amountOut
        // But amountInMaximum gives us the maximum input, so we can estimate
        const estimatedPrice = amountInMaximum / amountIn;
        return estimatedPrice;
      }
      return 0;
    } catch (error) {
      console.warn('⚠️  Error calculating price from swap amounts:', error);
      return 0;
    }
  }

  /**
   * Detect arbitrage opportunities using the sophisticated strategies focused on the specific swap
   */
  private async detectArbitrageOpportunities(swapData: any, currentPrice: number): Promise<ArbitrageOpportunity[]> {
    try {
      // Convert swapData to the expected SwapData format
      const swapDataFormatted = {
        tokenIn: swapData.tokenIn,
        tokenOut: swapData.tokenOut,
        amountIn: swapData.amountIn,
        amountInMaximum: swapData.amountInMaximum,
        fee: swapData.fee,
        sqrtPriceLimit: swapData.sqrtPriceLimit,
        recipient: swapData.recipient,
        signature: swapData.signature,
        uniqueKey: swapData.uniqueKey,
        method: swapData.method,
        uniqueId: swapData.uniqueId
      };
      
      // Use the new swap-focused arbitrage detector
      const opportunities = await this.arbitrageDetector.detectOpportunitiesForSwap(
        swapDataFormatted, 
        currentPrice, 
        this.api
      );

      // Enhance opportunities with current market price information
      const enhancedOpportunities = opportunities.map(opp => {
        // Calculate price discrepancy with current market price
        const priceDiscrepancy = this.calculatePriceDiscrepancy(opp, currentPrice);
        
        return {
          ...opp,
          currentMarketPrice: currentPrice,
          priceDiscrepancy: priceDiscrepancy,
          // Boost confidence if current price aligns with opportunity
          confidence: opp.profitPercentage > 0 ? opp.profitPercentage + (priceDiscrepancy * 10) : opp.profitPercentage
        };
      });

      // Sort by enhanced confidence (price discrepancy + profit percentage)
      return enhancedOpportunities.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    } catch (error) {
      console.error('❌ Error detecting arbitrage opportunities:', error);
      return [];
    }
  }

  /**
   * Calculate price discrepancy between opportunity and current market price
   */
  private calculatePriceDiscrepancy(opportunity: ArbitrageOpportunity, currentPrice: number): number {
    try {
      // Get the expected price from the opportunity
      const expectedPrice = opportunity.buyPrice || opportunity.sellPrice || 0;
      
      if (expectedPrice === 0 || currentPrice === 0) {
        return 0;
      }

      // Calculate percentage difference
      const discrepancy = Math.abs((expectedPrice - currentPrice) / currentPrice) * 100;
      
      // Return positive if opportunity price is higher (better for arbitrage)
      return expectedPrice > currentPrice ? discrepancy : -discrepancy;
    } catch (error) {
      console.warn('⚠️  Error calculating price discrepancy:', error);
      return 0;
    }
  }


  /**
   * Execute the arbitrage trade
   */
  private async executeArbitrageTrade(opportunity: ArbitrageOpportunity, swapData: any): Promise<void> {
    try {
      console.log(`🚀 Executing arbitrage trade: ${opportunity.tokenA} -> ${opportunity.tokenB}`);
      console.log(`   Token Pair: ${swapData.tokenIn.collection} -> ${swapData.tokenOut.collection}`);
      console.log(`   Amount: ${opportunity.maxTradeAmount}`);
      console.log(`   Expected Profit: ${opportunity.profitPercentage.toFixed(2)}%`);
      
      let success = false;
      
      if (config.mockMode) {
        // Execute mock trade
        console.log('🎭 Executing mock arbitrage trade...');
        success = await this.mockTradeExecutor.executeArbitrageTrade(opportunity);
      } else {
        // Execute real trade
        console.log('💰 Executing real arbitrage trade...');
        const execution = await this.tradeExecutor.executeArbitrage(opportunity);
        
        if (execution.status === 'completed') {
          success = true;
          console.log(`✅ Real arbitrage trade completed successfully`);
          console.log(`   Execution ID: ${execution.id}`);
          console.log(`   Actual Profit: ${execution.actualProfit?.toFixed(2) || 'N/A'}`);
          console.log(`   Buy Transaction: ${execution.buySwap?.transactionHash || 'N/A'}`);
          console.log(`   Sell Transaction: ${execution.sellSwap?.transactionHash || 'N/A'}`);
        } else {
          console.log(`❌ Real arbitrage trade failed: ${execution.status}`);
          if (execution.error) {
            console.log(`   Error: ${execution.error}`);
          }
        }
      }
      
      if (success) {
        this.tradesExecuted++;
        console.log(`✅ Arbitrage trade executed successfully (#${this.tradesExecuted})`);
        console.log(`   Profit: ${opportunity.profitPercentage.toFixed(2)}%`);
      } else {
        console.log(`❌ Arbitrage trade execution failed`);
      }
      
    } catch (error) {
      console.error('❌ Error executing arbitrage trade:', error);
    }
  }

  /**
   * Get processing statistics
   */
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

    // Add mock statistics if in mock mode
    if (config.mockMode) {
      stats.mockStats = this.mockTradeExecutor.getStats();
    }

    return stats;
  }

  /**
   * Generate final mock report (for mock mode)
   */
  async generateMockReport(): Promise<void> {
    if (config.mockMode) {
      await this.mockTradeExecutor.generateFinalReport();
    }
  }

  /**
   * Clear processed data (for testing)
   */
  clearProcessedData(): void {
    this.processedBlocks.clear();
    this.processedTransactions.clear();
    this.filteredBlocks = 0;
    this.opportunitiesFound = 0;
    this.tradesExecuted = 0;
  }
}
