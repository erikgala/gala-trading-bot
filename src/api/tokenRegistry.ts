import { stringifyTokenClassKey } from '@gala-chain/gswap-sdk';
import type {
  GalaSwapToken,
  GalaSwapTokenListResponse,
  TokenInfo
} from './types';

const FALLBACK_TOKENS: TokenInfo[] = [
  { symbol: 'GALA', name: 'Gala', decimals: 8, tokenClass: 'GALA|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GUSDC', name: 'Gala USD Coin', decimals: 6, tokenClass: 'GUSDC|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GUSDT', name: 'Gala Tether', decimals: 6, tokenClass: 'GUSDT|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GWETH', name: 'Gala Wrapped Ethereum', decimals: 18, tokenClass: 'GWETH|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GWBTC', name: 'Gala Wrapped Bitcoin', decimals: 8, tokenClass: 'GWBTC|Unit|none|none', price: 0, priceChange24h: 0 }
];

export interface TokenRegistryOptions {
  galaSwapApiUrl: string;
  fetchFn?: typeof fetch;
}

export class TokenRegistry {
  private readonly fetchFn: typeof fetch;
  private availableTokens: TokenInfo[] = [];
  private tokensLoaded = false;

  constructor(private readonly options: TokenRegistryOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  isLoaded(): boolean {
    return this.tokensLoaded;
  }

  async loadTokens(): Promise<void> {
    if (this.tokensLoaded) {
      return;
    }

    try {
      console.log('🔄 Loading available tokens from GalaSwap API...');
      const data = await this.fetchTokenList();

      if (data.status === 200 && data.data?.token) {
        this.availableTokens = data.data.token.map(this.transformToken);
        console.log(`✅ Loaded ${this.availableTokens.length} available tokens from GalaSwap`);
      } else {
        throw new Error('Failed to load tokens from GalaSwap API');
      }
    } catch (error) {
      console.error('❌ Failed to load available tokens:', error);
      this.availableTokens = [...FALLBACK_TOKENS];
      console.log('⚠️  Using fallback token list');
    } finally {
      this.tokensLoaded = true;
    }
  }

  async getAvailableTokens(): Promise<TokenInfo[]> {
    if (!this.tokensLoaded) {
      await this.loadTokens();
    }

    return [...this.availableTokens];
  }

  async getTokenInfoByClassKey(tokenClassKey: string): Promise<TokenInfo | null> {
    if (!this.tokensLoaded) {
      await this.loadTokens();
    }

    return this.availableTokens.find(token => token.tokenClass === tokenClassKey) ?? null;
  }

  async getTokenInfoBySymbol(symbol: string): Promise<TokenInfo | null> {
    if (!this.tokensLoaded) {
      await this.loadTokens();
    }

    return this.availableTokens.find(token => token.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
  }

  getTokenByClassKey(tokenClassKey: string): TokenInfo | null {
    if (!this.tokensLoaded) {
      return null;
    }

    return this.availableTokens.find(token => token.tokenClass === tokenClassKey) ?? null;
  }

  isTokenAvailableByClassKey(tokenClassKey: string): boolean {
    if (!this.tokensLoaded) {
      return false;
    }

    return this.availableTokens.some(token => token.tokenClass === tokenClassKey);
  }

  isTokenAvailableBySymbol(symbol: string): boolean {
    if (!this.tokensLoaded) {
      return false;
    }

    return this.availableTokens.some(token => token.symbol.toUpperCase() === symbol.toUpperCase());
  }

  private async fetchTokenList(): Promise<GalaSwapTokenListResponse> {
    const response = await this.fetchFn(`${this.options.galaSwapApiUrl}/user/token-list?search=&page=1&limit=100`);
    return await response.json() as GalaSwapTokenListResponse;
  }

  private transformToken(token: GalaSwapToken): TokenInfo {
    return {
      symbol: token.symbol,
      name: token.name,
      decimals: parseInt(token.decimals, 10),
      tokenClass: token.compositeKey.replace(/\$/g, '|'),
      price: 0,
      priceChange24h: 0,
    };
  }
}

export function createTokenClassKey(tokenData: {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
}): string {
  return stringifyTokenClassKey({
    collection: tokenData.collection,
    category: tokenData.category,
    type: tokenData.type,
    additionalKey: tokenData.additionalKey,
  });
}
