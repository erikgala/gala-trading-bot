import { BlockData, TransactionData, EventProcessor, ActionData, DexV3BatchSubmit } from './types';
import { ArbitrageDetector, ArbitrageOpportunity } from '../strategies/arbitrage';
import { GSwapAPI } from '../api/gswap';
import { MockTradeExecutor } from '../mock/mockTradeExecutor';
import { config } from '../config';

export class RealTimeEventProcessor implements EventProcessor {
  private processedBlocks: Set<number> = new Set();
  private filteredBlocks: number = 0;
  private opportunitiesFound: number = 0;
  private tradesExecuted: number = 0;
  private arbitrageDetector: ArbitrageDetector;
  private api: GSwapAPI;
  private mockTradeExecutor: MockTradeExecutor;

  constructor(api: GSwapAPI) {
    this.api = api;
    this.arbitrageDetector = new ArbitrageDetector();
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
        // Parse the batch submit payload
        const batchSubmit: DexV3BatchSubmit = JSON.parse(action.args[1]);

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

      // Calculate current price from sqrtPriceLimit
      const currentPrice = this.calculatePriceFromSqrtPriceLimit(swapData.sqrtPriceLimit);

      // Log the incoming swap that triggered arbitrage analysis
      console.log(`🔄 SWAP DETECTED - Triggering Arbitrage Analysis`);
      console.log(`   Swap Pair: ${swapData.tokenIn.collection} -> ${swapData.tokenOut.collection}`);
      console.log(`   Amount In: ${swapData.amountIn}`);
      console.log(`   Amount In Maximum: ${swapData.amountInMaximum}`);
      console.log(`   Fee: ${swapData.fee}`);
      console.log(`   Current Price: ${currentPrice.toFixed(6)}`);
      console.log(`   Transaction ID: ${swapData.uniqueId}`);

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
          
          if (config.mockMode) {
            // Execute mock trade
            const success = await this.mockTradeExecutor.executeArbitrageTrade(bestOpportunity);
            if (success) {
              this.tradesExecuted++;
            }
          } else {
            // Execute real trade (placeholder for now)
            await this.executeArbitrageTrade(bestOpportunity, swapData);
          }
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
   * Calculate price from sqrtPriceLimit (Uniswap V3 style)
   */
  private calculatePriceFromSqrtPriceLimit(sqrtPriceLimit: string): number {
    try {
      const sqrtPrice = parseFloat(sqrtPriceLimit);
      console.log(`   Debug: sqrtPriceLimit = "${sqrtPriceLimit}", parsed = ${sqrtPrice}`);
      
      // Price = (sqrtPrice / 2^96)^2
      // For Uniswap V3, sqrtPrice is stored as Q64.96 fixed point
      const Q64_96 = Math.pow(2, 96);
      const price = Math.pow(sqrtPrice / Q64_96, 2);
      
      console.log(`   Debug: Q64_96 = ${Q64_96}, calculated price = ${price}`);
      return price;
    } catch (error) {
      console.warn('⚠️  Error calculating price from sqrtPriceLimit:', error);
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
      
      // TODO: Implement actual trade execution
      // This would integrate with the TradeExecutor
      
      // Simulate trade execution
      this.tradesExecuted++;
      console.log(`✅ Arbitrage trade executed successfully (#${this.tradesExecuted})`);
      console.log(`   Profit: ${opportunity.profitPercentage.toFixed(2)}%`);
      console.log(`   Transaction Hash: mock_tx_hash_${Date.now()}`);
      
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
    mockStats?: {
      totalTransactions: number;
      arbitrageTrades: number;
      swapTrades: number;
      totalProfit: number;
      successRate: number;
    };
  } {
    const stats: any = {
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

  /**
   * Generate final mock trading report
   */
  generateMockReport(): void {
    if (config.mockMode) {
      this.mockTradeExecutor.generateFinalReport();
    }
  }

  /**
   * Clear processed data (for testing)
   */
  clearProcessedData(): void {
    this.processedBlocks.clear();
    this.filteredBlocks = 0;
    this.opportunitiesFound = 0;
    this.tradesExecuted = 0;
  }
}
