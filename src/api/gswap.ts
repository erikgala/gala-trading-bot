import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { config } from '../config';
import { BalanceManager, BalanceSnapshot } from './balanceManager';
import { buildQuoteCacheKey, cloneQuoteMap } from './quotes';
import { createTokenClassKey, TokenRegistry } from './tokenRegistry';
import type {
  QuoteMap,
  SwapQuote,
  SwapResult,
  TokenInfo,
  TradingPair,
  UserAssetsResponse,
} from './types';
import { RateLimiter } from '../streaming/rateLimiter';
import { getSupportedTokenClassPairs, isSupportedPair } from '../config/tradingPairs';

export { BalanceSnapshot } from './balanceManager';
export { buildQuoteCacheKey } from './quotes';
export { createTokenClassKey } from './tokenRegistry';
export type { QuoteCacheEntry, QuoteMap, SwapQuote, SwapResult, TokenInfo, TradingPair } from './types';

export class GSwapAPI {
  private readonly gSwap: GSwap;
  private readonly signer: PrivateKeySigner;
  private readonly tokenRegistry: TokenRegistry;
  private readonly balanceManager: BalanceManager;
  private readonly isMockMode: boolean;
  private latestQuoteMap: QuoteMap = new Map();
  private noPoolAvailableCache: Set<string> = new Set();
  private rateLimiter?: RateLimiter;

  constructor(rateLimiter?: RateLimiter) {
    this.signer = new PrivateKeySigner(config.privateKey);
    this.gSwap = new GSwap({
      signer: this.signer,
    });

    GSwap.events?.connectEventSocket();

    this.isMockMode = config.mockMode;

    this.tokenRegistry = new TokenRegistry({
      galaSwapApiUrl: config.galaSwapApiUrl,
    });

    this.balanceManager = new BalanceManager({
      isMockMode: this.isMockMode,
      balanceRefreshInterval: config.balanceRefreshInterval,
      mockWalletBalances: config.mockWalletBalances,
      fetchUserAssets: () => this.fetchUserAssets(),
    });
    
    this.rateLimiter = rateLimiter;
  }

  async loadAvailableTokens(): Promise<void> {
    await this.tokenRegistry.loadTokens();
  }

  async getTokenInfoByClassKey(tokenClassKey: string): Promise<TokenInfo | null> {
    return this.tokenRegistry.getTokenInfoByClassKey(tokenClassKey);
  }

  async getTokenInfo(symbol: string): Promise<TokenInfo | null> {
    return this.tokenRegistry.getTokenInfoBySymbol(symbol);
  }

  async getAvailableTokens(): Promise<TokenInfo[]> {
    return this.tokenRegistry.getAvailableTokens();
  }

  async getTradingPairs(): Promise<TradingPair[]> {
    try {
      const tokens = await this.getAvailableTokens();
      const tokensByClass = new Map(tokens.map(token => [token.symbol, token]));
      const pairs: TradingPair[] = [];
      const quoteMap: QuoteMap = new Map();

      for (const [tokenSymbolA, tokenSymbolB] of getSupportedTokenClassPairs()) {
        const tokenA = tokensByClass.get(tokenSymbolA);
        const tokenB = tokensByClass.get(tokenSymbolB);

        if (!tokenA || !tokenB) {
          console.warn(`⚠️  Missing token information for pair ${tokenSymbolA} <-> ${tokenSymbolB}`);
          continue;
        }

        const tokenClassA = tokenA.tokenClass;
        const tokenClassB = tokenB.tokenClass;

        try {
          const quoteAB = await this.getQuote(tokenClassA, tokenClassB, 1);
          const quoteBA = await this.getQuote(tokenClassB, tokenClassA, 1);

          const timestamp = Date.now();

          if (quoteAB) {
            quoteMap.set(
              buildQuoteCacheKey(tokenClassA, tokenClassB, quoteAB.inputAmount),
              { quote: quoteAB, timestamp },
            );
          }

          if (quoteBA) {
            quoteMap.set(
              buildQuoteCacheKey(tokenClassB, tokenClassA, quoteBA.inputAmount),
              { quote: quoteBA, timestamp },
            );
          }

          if (quoteAB && quoteBA) {
            pairs.push({
              tokenA,
              tokenB,
              tokenClassA,
              tokenClassB,
            });
          } else if (!quoteAB && !quoteBA) {
            console.warn(`No liquidity for ${tokenA.symbol} <-> ${tokenB.symbol}`);
          }
        } catch (error) {
          console.warn(`Error fetching quotes for ${tokenA.symbol} <-> ${tokenB.symbol}:`, error);
        }
      }

      this.latestQuoteMap = quoteMap;

      return pairs;
    } catch (error) {
      console.error('Failed to get trading pairs:', error);
      throw error;
    }
  }

  getLatestQuoteMap(): QuoteMap {
    return cloneQuoteMap(this.latestQuoteMap);
  }

  async getBalanceSnapshot(forceRefresh: boolean = false): Promise<BalanceSnapshot> {
    return this.balanceManager.getSnapshot(forceRefresh);
  }

  async refreshBalanceSnapshot(): Promise<BalanceSnapshot> {
    return this.balanceManager.refreshSnapshot();
  }

  async getQuote(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
  ): Promise<SwapQuote | null> {
    try {
      if (!isSupportedPair(inputTokenClass, outputTokenClass)) {
        return null;
      }

      const key = `${inputTokenClass}-${outputTokenClass}`;
      if(this.noPoolAvailableCache.has(key)) {
        return null;
      }

      const quote = await this.gSwap.quoting.quoteExactInput(
        inputTokenClass,
        outputTokenClass,
        inputAmount,
      );

      return {
        inputToken: inputTokenClass,
        outputToken: outputTokenClass,
        inputAmount,
        outputAmount: quote.outTokenAmount.toNumber(),
        priceImpact: quote.priceImpact ? quote.priceImpact.toNumber() : 0,
        feeTier: quote.feeTier,
        route: [],
      };
    } catch (error: any) {
      if(error.code === "NO_POOL_AVAILABLE") {
        const key = `${inputTokenClass}-${outputTokenClass}`;
        this.noPoolAvailableCache.add(key);
      }
      
      // Check for 403 rate limiting error
      if (error.code === 'HTTP_ERROR' && error.details?.status === 403) {
        console.error(`🚫 Rate limited by API for ${inputTokenClass} -> ${outputTokenClass}`);
        if (this.rateLimiter) {
          this.rateLimiter.triggerRateLimit();
        }
      }
      
      console.error(`Failed to get quote for ${inputTokenClass} -> ${outputTokenClass}:`, error);
      return null;
    }
  }

  async executeSwap(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    slippageTolerance: number = config.slippageTolerance,
    providedQuote?: SwapQuote,
  ): Promise<SwapResult> {
    try {
      let quote = this.isQuoteValidForSwap(providedQuote, inputTokenClass, outputTokenClass, inputAmount)
        ? providedQuote
        : undefined;

      if (!quote) {
        const fetchedQuote = await this.getQuote(inputTokenClass, outputTokenClass, inputAmount);
        quote = fetchedQuote || undefined;
      }

      if (!quote) {
        throw new Error('Unable to get quote for swap');
      }

      const minOutputAmount = quote.outputAmount * (1 - slippageTolerance / 100);

      if (this.isMockMode) {
        this.balanceManager.applyMockSwap(inputTokenClass, outputTokenClass, inputAmount, quote.outputAmount);

        return {
          transactionHash: `mock_tx_${Date.now()}`,
          inputAmount,
          outputAmount: quote.outputAmount,
          actualPrice: quote.outputAmount / inputAmount,
          gasUsed: 0,
          timestamp: Date.now(),
        };
      }

      const swapParams = {
        exactIn: inputAmount,
        amountOutMinimum: minOutputAmount,
      };

      const pendingTransaction = await this.gSwap.swaps.swap(
        inputTokenClass,
        outputTokenClass,
        quote.feeTier,
        swapParams,
        config.walletAddress,
      );

      const result = await pendingTransaction.wait();

      console.log('Swap result:', JSON.stringify(result, null, 2));

      await this.refreshBalanceSnapshot();

      return {
        transactionHash: result.transactionHash,
        inputAmount,
        outputAmount: quote.outputAmount,
        actualPrice: quote.outputAmount / inputAmount,
        gasUsed: 1,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Failed to execute swap:', error);
      throw error;
    }
  }

  async checkTradingFunds(requiredAmount: number, tokenClass: string, snapshot?: BalanceSnapshot): Promise<{
    hasFunds: boolean;
    currentBalance: number;
    shortfall: number;
  }> {
    return this.balanceManager.checkTradingFunds(requiredAmount, tokenClass, snapshot);
  }

  isTokenAvailableByClassKey(tokenClassKey: string): boolean {
    if (!this.tokenRegistry.isLoaded()) {
      console.warn('⚠️  Token list not loaded yet, cannot validate token');
      return false;
    }

    return this.tokenRegistry.isTokenAvailableByClassKey(tokenClassKey);
  }

  isTokenAvailable(tokenSymbol: string): boolean {
    if (!this.tokenRegistry.isLoaded()) {
      console.warn('⚠️  Token list not loaded yet, cannot validate token');
      return false;
    }

    return this.tokenRegistry.isTokenAvailableBySymbol(tokenSymbol);
  }

  getTokenByClassKey(tokenClassKey: string): TokenInfo | null {
    return this.tokenRegistry.getTokenByClassKey(tokenClassKey);
  }

  createTokenClassKey(tokenData: { collection: string; category: string; type: string; additionalKey: string }): string {
    return createTokenClassKey(tokenData);
  }

  async testConnection(): Promise<boolean> {
    try {
      const quote = await this.getQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1);
      return quote !== null;
    } catch (error) {
      console.error('gSwap connection test failed:', error);
      return false;
    }
  }

  private isQuoteValidForSwap(
    quote: SwapQuote | undefined,
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
  ): quote is SwapQuote {
    if (!quote) {
      return false;
    }

    const tokensMatch =
      quote.inputToken === inputTokenClass && quote.outputToken === outputTokenClass;
    if (!tokensMatch) {
      return false;
    }

    const tolerance = Math.max(1e-8, Math.abs(inputAmount) * 1e-6);
    const amountMatches = Math.abs(quote.inputAmount - inputAmount) <= tolerance;

    return amountMatches && quote.outputAmount > 0;
  }

  private async fetchUserAssets(): Promise<UserAssetsResponse> {
    if (this.isMockMode) {
      return { tokens: [] };
    }

    return await this.gSwap.assets.getUserAssets(config.walletAddress, 1, 20) as UserAssetsResponse;
  }
}
