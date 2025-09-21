import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import { config } from '../config';
import { BalanceManager, BalanceSnapshot } from './balanceManager';
import { buildQuoteCacheKey, cloneQuoteMap } from './quotes';
import { createTokenClassKey, TokenRegistry } from './tokenRegistry';
import type {
  QuoteCacheEntry,
  QuoteMap,
  SwapQuote,
  SwapResult,
  TokenInfo,
  TradingPair,
  UserAssetsResponse,
} from './types';

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

  constructor() {
    this.signer = new PrivateKeySigner(config.privateKey);
    this.gSwap = new GSwap({
      signer: this.signer,
    });

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
  }

  getWalletAddress(): string {
    return config.walletAddress;
  }

  async loadAvailableTokens(): Promise<void> {
    await this.tokenRegistry.loadTokens();
  }

  async getTokenInfoByClassKey(tokenClassKey: string): Promise<TokenInfo | null> {
    return this.tokenRegistry.getTokenInfoByClassKey(tokenClassKey);
  }

  async getTokenInfoByData(tokenData: { collection: string; category: string; type: string; additionalKey: string }): Promise<TokenInfo | null> {
    const tokenClassKey = createTokenClassKey(tokenData);
    return this.getTokenInfoByClassKey(tokenClassKey);
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
      const pairs: TradingPair[] = [];
      const quoteMap: QuoteMap = new Map();

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
              this.getQuote(otherToken.tokenClass, galaToken.tokenClass, 1),
            ]);

            const timestamp = Date.now();

            if (quoteAB) {
              quoteMap.set(
                buildQuoteCacheKey(galaToken.tokenClass, otherToken.tokenClass, quoteAB.inputAmount),
                { quote: quoteAB, timestamp },
              );
            }

            if (quoteBA) {
              quoteMap.set(
                buildQuoteCacheKey(otherToken.tokenClass, galaToken.tokenClass, quoteBA.inputAmount),
                { quote: quoteBA, timestamp },
              );
            }

            if (quoteAB && quoteBA) {
              pairs.push({
                tokenA: galaToken,
                tokenB: otherToken,
                tokenClassA: galaToken.tokenClass,
                tokenClassB: otherToken.tokenClass,
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
    } catch (error) {
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
      const feeTier = Math.floor(quote.feeTier * 10000);

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

      await this.gSwap.swaps.swap(
        inputTokenClass,
        outputTokenClass,
        feeTier,
        swapParams,
        config.walletAddress,
      );

      await this.refreshBalanceSnapshot();

      return {
        transactionHash: 'unknown',
        inputAmount,
        outputAmount: quote.outputAmount,
        actualPrice: quote.outputAmount / inputAmount,
        gasUsed: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Failed to execute swap:', error);
      throw error;
    }
  }

  async getCurrentPrice(inputTokenClass: string, outputTokenClass: string): Promise<number | null> {
    try {
      const quote = await this.getQuote(inputTokenClass, outputTokenClass, 1);
      return quote ? quote.outputAmount : null;
    } catch (error) {
      console.error(`Failed to get current price for ${inputTokenClass} -> ${outputTokenClass}:`, error);
      return null;
    }
  }

  async isSwapProfitable(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    minProfitPercentage: number,
  ): Promise<{ profitable: boolean; profitPercentage: number; quote: SwapQuote | null }> {
    try {
      const quote = await this.getQuote(inputTokenClass, outputTokenClass, inputAmount);

      if (!quote) {
        return { profitable: false, profitPercentage: 0, quote: null };
      }

      const profitPercentage = ((quote.outputAmount - inputAmount) / inputAmount) * 100;
      const profitable = profitPercentage >= minProfitPercentage;

      return { profitable, profitPercentage, quote };
    } catch (error) {
      console.error('Failed to check swap profitability:', error);
      return { profitable: false, profitPercentage: 0, quote: null };
    }
  }

  async getTokenBalance(tokenClass: string): Promise<number> {
    try {
      const snapshot = await this.getBalanceSnapshot();
      return snapshot.getBalance(tokenClass);
    } catch (error) {
      console.error(`Failed to get balance for ${tokenClass}:`, error);
      return 0;
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

  isTokenAvailableByData(tokenData: { collection: string; category: string; type: string; additionalKey: string }): boolean {
    const tokenClassKey = createTokenClassKey(tokenData);
    return this.isTokenAvailableByClassKey(tokenClassKey);
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

    return await this.gSwap.assets.getUserAssets(config.walletAddress, 1, 100) as UserAssetsResponse;
  }
}
