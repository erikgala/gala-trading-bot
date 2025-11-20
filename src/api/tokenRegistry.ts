import { stringifyTokenClassKey } from '@gala-chain/gswap-sdk';
import type {
  GalaSwapToken,
  GalaSwapTokenListResponse,
  TokenInfo
} from './types';
import { SUPPORTED_TOKENS } from '../config/tradingPairs';

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
    this.availableTokens = [...SUPPORTED_TOKENS];
    this.tokensLoaded = true;
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
    const response = await this.fetchFn(`${this.options.galaSwapApiUrl}/user/token-list?search=&page=1&limit=20`);
    return await response.json() as GalaSwapTokenListResponse;
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
