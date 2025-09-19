import { GSwap, PrivateKeySigner, stringifyTokenClassKey } from '@gala-chain/gswap-sdk';
import { config } from '../config';

// Types for GalaSwap API responses
interface GalaSwapToken {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
  decimals: string;
  quantity: string;
  compositeKey: string;
  image: string;
  name: string;
  symbol: string;
  description: string;
  verify: boolean;
}

interface GalaSwapTokenListResponse {
  status: number;
  error: boolean;
  message: string;
  data: {
    token: GalaSwapToken[];
    count: number;
  };
}

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

export interface QuoteCacheEntry {
  quote: SwapQuote;
  timestamp: number;
}

export type QuoteMap = Map<string, QuoteCacheEntry>;

export function buildQuoteCacheKey(
  inputTokenClass: string,
  outputTokenClass: string,
  inputAmount: number
): string {
  return `${inputTokenClass}::${outputTokenClass}::${inputAmount}`;
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
  private availableTokens: TokenInfo[] = [];
  private tokensLoaded: boolean = false;
  private latestQuoteMap: QuoteMap = new Map();

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
   * Load all available tokens from GalaSwap API at startup
   */
  async loadAvailableTokens(): Promise<void> {
    try {
      console.log('🔄 Loading available tokens from GalaSwap API...');
      
      // Fetch all available tokens from GalaSwap API
      const response = await fetch(`${config.galaSwapApiUrl}/user/token-list?search=&page=1&limit=100`);
      const data = await response.json() as GalaSwapTokenListResponse;
      
      if (data.status === 200 && data.data && data.data.token) {
        this.availableTokens = data.data.token.map(token => ({
          symbol: token.symbol,
          name: token.name,
          decimals: parseInt(token.decimals),
          tokenClass: token.compositeKey.replace(/\$/g, '|'),
          price: 0, // Will be fetched from quotes
          priceChange24h: 0
        }));
        
        this.tokensLoaded = true;
        console.log(`✅ Loaded ${this.availableTokens.length} available tokens from GalaSwap`);
      } else {
        throw new Error('Failed to load tokens from GalaSwap API');
      }
    } catch (error) {
      console.error('❌ Failed to load available tokens:', error);
      // Fallback to common tokens
      this.availableTokens = [
        { symbol: 'GALA', name: 'Gala', decimals: 8, tokenClass: 'GALA|Unit|none|none', price: 0, priceChange24h: 0 },
        { symbol: 'GUSDC', name: 'Gala USD Coin', decimals: 6, tokenClass: 'GUSDC|Unit|none|none', price: 0, priceChange24h: 0 },
        { symbol: 'GUSDT', name: 'Gala Tether', decimals: 6, tokenClass: 'GUSDT|Unit|none|none', price: 0, priceChange24h: 0 },
        { symbol: 'GWETH', name: 'Gala Wrapped Ethereum', decimals: 18, tokenClass: 'GWETH|Unit|none|none', price: 0, priceChange24h: 0 },
        { symbol: 'GWBTC', name: 'Gala Wrapped Bitcoin', decimals: 8, tokenClass: 'GWBTC|Unit|none|none', price: 0, priceChange24h: 0 }
      ];
      this.tokensLoaded = true;
      console.log('⚠️  Using fallback token list');
    }
  }

  /**
   * Get all available tokens from cached list
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    try {
      // Ensure tokens are loaded
      if (!this.tokensLoaded) {
        await this.loadAvailableTokens();
      }

      return [...this.availableTokens]; // Return a copy to prevent external modification
    } catch (error) {
      console.error('Failed to get available tokens:', error);
      return [];
    }
  }

  /**
   * Get trading pairs by checking which tokens can be swapped (GALA pairs only)
   */
  async getTradingPairs(): Promise<TradingPair[]> {
    try {
      const tokens = await this.getAvailableTokens();
      const pairs: TradingPair[] = [];
      const quoteMap: QuoteMap = new Map();

      // Find GALA token
      const galaToken = tokens.find(token => token.tokenClass === 'GALA|Unit|none|none');
      if (!galaToken) {
        console.warn('⚠️  GALA token not found in available tokens');
        this.latestQuoteMap = quoteMap;
        return [];
      }

      const tokensToCheck = tokens.filter(token => token.tokenClass !== galaToken.tokenClass);
      const concurrencyLimit = Math.max(1, Math.min(5, tokensToCheck.length));
      let index = 0;

      const processNext = async (): Promise<void> => {
        while (true) {
          const currentIndex = index++;
          if (currentIndex >= tokensToCheck.length) {
            return;
          }

          const otherToken = tokensToCheck[currentIndex];

          try {
            const [quoteAB, quoteBA] = await Promise.all([
              this.getQuote(galaToken.tokenClass, otherToken.tokenClass, 1),
              this.getQuote(otherToken.tokenClass, galaToken.tokenClass, 1)
            ]);

            const timestamp = Date.now();

            if (quoteAB) {
              quoteMap.set(
                buildQuoteCacheKey(galaToken.tokenClass, otherToken.tokenClass, quoteAB.inputAmount),
                { quote: quoteAB, timestamp }
              );
            }

            if (quoteBA) {
              quoteMap.set(
                buildQuoteCacheKey(otherToken.tokenClass, galaToken.tokenClass, quoteBA.inputAmount),
                { quote: quoteBA, timestamp }
              );
            }

            if (quoteAB && quoteBA) {
              pairs.push({
                tokenA: galaToken,
                tokenB: otherToken,
                tokenClassA: galaToken.tokenClass,
                tokenClassB: otherToken.tokenClass
              });
            } else {
              console.warn(`No liquidity for GALA <-> ${otherToken.symbol}`);
            }
          } catch (error) {
            console.warn(`Error fetching quotes for GALA <-> ${otherToken.symbol}:`, error);
          }
        }
      };

      await Promise.all(Array.from({ length: concurrencyLimit }, () => processNext()));

      this.latestQuoteMap = quoteMap;

      return pairs;
    } catch (error) {
      console.error('Failed to get trading pairs:', error);
      throw error;
    }
  }

  getLatestQuoteMap(): QuoteMap {
    return new Map(this.latestQuoteMap);
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
   * Get wallet balance for a token using gSwap SDK
   */
  async getTokenBalance(tokenClass: string): Promise<number> {
    try {
      // Get user's assets using gSwap SDK (more efficient)
      const userAssets = await this.gSwap.assets.getUserAssets(config.walletAddress, 1, 100);
      
      // Find token by matching the token class key
      const userToken = userAssets.tokens.find(token => {
        // Create token class key from user asset data
        const userTokenClassKey = stringifyTokenClassKey({
          collection: token.symbol, // In user assets, symbol is the collection
          category: 'Unit',
          type: 'none',
          additionalKey: 'none'
        });
        return userTokenClassKey === tokenClass;
      });

      if (userToken) {
        return parseFloat(userToken.quantity);
      }

      return 0;
    } catch (error) {
      console.error(`Failed to get balance for ${tokenClass}:`, error);
      return 0;
    }
  }

  /**
   * Check if wallet has sufficient balance for trading
   */
  async checkTradingFunds(requiredAmount: number, tokenClass: string): Promise<{
    hasFunds: boolean;
    currentBalance: number;
    shortfall: number;
  }> {
    try {
      const currentBalance = await this.getTokenBalance(tokenClass);
      const shortfall = Math.max(0, requiredAmount - currentBalance);
      
      return {
        hasFunds: currentBalance >= requiredAmount,
        currentBalance,
        shortfall
      };
    } catch (error) {
      console.error(`Failed to check trading funds for ${tokenClass}:`, error);
      return {
        hasFunds: false,
        currentBalance: 0,
        shortfall: requiredAmount
      };
    }
  }

  /**
   * Validate if a token is available on GalaSwap by token class key
   */
  isTokenAvailableByClassKey(tokenClassKey: string): boolean {
    if (!this.tokensLoaded) {
      console.warn('⚠️  Token list not loaded yet, cannot validate token');
      return false;
    }

    return this.availableTokens.some(token => 
      token.tokenClass === tokenClassKey
    );
  }

  /**
   * Create token class key from block token data
   */
  createTokenClassKey(tokenData: { collection: string; category: string; type: string; additionalKey: string }): string {
    return stringifyTokenClassKey({
      collection: tokenData.collection,
      category: tokenData.category,
      type: tokenData.type,
      additionalKey: tokenData.additionalKey
    });
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
