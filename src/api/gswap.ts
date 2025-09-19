import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { config } from '../config';

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  tokenClass: string; // Format: "SYMBOL|Unit|none|none"
  price: number;
  priceChange24h: number;
}

export interface TradingPair {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  tokenClassA: string;
  tokenClassB: string;
}

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  feeTier: number;
  route: string[];
}

export interface SwapResult {
  transactionHash: string;
  inputAmount: number;
  outputAmount: number;
  actualPrice: number;
  gasUsed: number;
  timestamp: number;
}

export class GSwapAPI {
  private gSwap: GSwap;
  private signer: PrivateKeySigner;

  constructor() {
    this.signer = new PrivateKeySigner(config.privateKey);
    this.gSwap = new GSwap({
      signer: this.signer,
    });
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    return config.walletAddress;
  }

  /**
   * Get token information for common tokens
   */
  async getTokenInfo(symbol: string): Promise<TokenInfo | null> {
    try {
      // Common token mappings - in a real implementation, you'd fetch this from the chain
      const tokenMap: Record<string, TokenInfo> = {
        'GALA': {
          symbol: 'GALA',
          name: 'Gala',
          decimals: 8,
          tokenClass: 'GALA|Unit|none|none',
          price: 0, // Will be fetched from quotes
          priceChange24h: 0
        },
        'GUSDC': {
          symbol: 'GUSDC',
          name: 'Gala USD Coin',
          decimals: 6,
          tokenClass: 'GUSDC|Unit|none|none',
          price: 0,
          priceChange24h: 0
        },
        'GETH': {
          symbol: 'GETH',
          name: 'Gala Ethereum',
          decimals: 18,
          tokenClass: 'GETH|Unit|none|none',
          price: 0,
          priceChange24h: 0
        },
        'GBTC': {
          symbol: 'GBTC',
          name: 'Gala Bitcoin',
          decimals: 8,
          tokenClass: 'GBTC|Unit|none|none',
          price: 0,
          priceChange24h: 0
        }
      };

      return tokenMap[symbol.toUpperCase()] || null;
    } catch (error) {
      console.error(`Failed to get token info for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get all available tokens
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    const commonTokens = ['GALA', 'GUSDC', 'GETH', 'GBTC'];
    const tokens: TokenInfo[] = [];

    for (const symbol of commonTokens) {
      const tokenInfo = await this.getTokenInfo(symbol);
      if (tokenInfo) {
        tokens.push(tokenInfo);
      }
    }

    return tokens;
  }

  /**
   * Get trading pairs by checking which tokens can be swapped
   */
  async getTradingPairs(): Promise<TradingPair[]> {
    try {
      const tokens = await this.getAvailableTokens();
      const pairs: TradingPair[] = [];

      // Test all possible combinations
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];

          // Test if we can get a quote in both directions
          try {
            const quoteAB = await this.getQuote(tokenA.tokenClass, tokenB.tokenClass, 1);
            const quoteBA = await this.getQuote(tokenB.tokenClass, tokenA.tokenClass, 1);

            if (quoteAB && quoteBA) {
              pairs.push({
                tokenA,
                tokenB,
                tokenClassA: tokenA.tokenClass,
                tokenClassB: tokenB.tokenClass
              });
            }
          } catch (error) {
            // Skip pairs that don't have liquidity
            console.warn(`No liquidity for ${tokenA.symbol} <-> ${tokenB.symbol}`);
          }
        }
      }

      return pairs;
    } catch (error) {
      console.error('Failed to get trading pairs:', error);
      throw error;
    }
  }

  /**
   * Get a quote for swapping tokens
   */
  async getQuote(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number
  ): Promise<SwapQuote | null> {
    try {
      const quote = await this.gSwap.quoting.quoteExactInput(
        inputTokenClass,
        outputTokenClass,
        inputAmount
      );

      return {
        inputToken: inputTokenClass,
        outputToken: outputTokenClass,
        inputAmount: inputAmount,
        outputAmount: quote.outTokenAmount.toNumber(),
        priceImpact: quote.priceImpact ? quote.priceImpact.toNumber() : 0,
        feeTier: quote.feeTier,
        route: []
      };
    } catch (error) {
      console.error(`Failed to get quote for ${inputTokenClass} -> ${outputTokenClass}:`, error);
      return null;
    }
  }

  /**
   * Execute a swap
   */
  async executeSwap(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    slippageTolerance: number = config.slippageTolerance
  ): Promise<SwapResult> {
    try {
      // Get quote first
      const quote = await this.getQuote(inputTokenClass, outputTokenClass, inputAmount);
      if (!quote) {
        throw new Error('Unable to get quote for swap');
      }

      // Calculate minimum output with slippage tolerance
      const minOutputAmount = quote.outputAmount * (1 - slippageTolerance / 100);

      // Execute the swap
      const swapParams = {
        exactIn: inputAmount,
        amountOutMinimum: minOutputAmount,
      };

      // Convert fee tier to proper format (0.3% = 3000)
      const feeTier = Math.floor(quote.feeTier * 10000);

      const transaction = await this.gSwap.swaps.swap(
        inputTokenClass,
        outputTokenClass,
        feeTier,
        swapParams,
        config.walletAddress
      );

      return {
        transactionHash: 'unknown', // Transaction hash not available in PendingTransaction
        inputAmount: inputAmount,
        outputAmount: quote.outputAmount,
        actualPrice: quote.outputAmount / inputAmount,
        gasUsed: 0, // Would need to parse from transaction receipt
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Failed to execute swap:', error);
      throw error;
    }
  }

  /**
   * Get current price for a token pair
   */
  async getCurrentPrice(inputTokenClass: string, outputTokenClass: string): Promise<number | null> {
    try {
      const quote = await this.getQuote(inputTokenClass, outputTokenClass, 1);
      return quote ? quote.outputAmount : null;
    } catch (error) {
      console.error(`Failed to get current price for ${inputTokenClass} -> ${outputTokenClass}:`, error);
      return null;
    }
  }

  /**
   * Check if a swap is profitable after fees
   */
  async isSwapProfitable(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    minProfitPercentage: number
  ): Promise<{ profitable: boolean; profitPercentage: number; quote: SwapQuote | null }> {
    try {
      const quote = await this.getQuote(inputTokenClass, outputTokenClass, inputAmount);
      
      if (!quote) {
        return { profitable: false, profitPercentage: 0, quote: null };
      }

      // Calculate profit percentage
      const profitPercentage = ((quote.outputAmount - inputAmount) / inputAmount) * 100;
      const profitable = profitPercentage >= minProfitPercentage;

      return { profitable, profitPercentage, quote };
    } catch (error) {
      console.error('Failed to check swap profitability:', error);
      return { profitable: false, profitPercentage: 0, quote: null };
    }
  }

  /**
   * Get wallet balance for a token
   */
  async getTokenBalance(tokenClass: string): Promise<number> {
    try {
      // This would need to be implemented based on the SDK's balance checking methods
      // For now, return a placeholder
      console.warn('getTokenBalance not implemented - returning 0');
      return 0;
    } catch (error) {
      console.error(`Failed to get balance for ${tokenClass}:`, error);
      return 0;
    }
  }

  /**
   * Test connection to gSwap
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to get a simple quote to test connection
      const quote = await this.getQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1);
      return quote !== null;
    } catch (error) {
      console.error('gSwap connection test failed:', error);
      return false;
    }
  }
}
