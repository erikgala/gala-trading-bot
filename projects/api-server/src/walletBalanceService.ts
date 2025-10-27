import { GSwap, PrivateKeySigner } from '@gala-chain/gswap-sdk';
import type { TokenPriceService } from './tokenPriceService';

export interface TrackedToken {
  symbol: string;
  tokenClass: string;
}

export interface WalletBalanceBreakdown {
  symbol: string;
  tokenClass: string;
  balance: number;
  usdPrice: number | null;
  usdValue: number | null;
}

export interface WalletBalanceOverview {
  balances: WalletBalanceBreakdown[];
  totalUsdValue: number;
  lastUpdated: string;
  isStale: boolean;
  warning: string | null;
}

interface WalletBalanceCacheEntry {
  data: WalletBalanceOverview;
  fetchedAt: number;
}

export interface WalletBalanceServiceOptions {
  walletAddress: string;
  privateKey: string;
  mockMode: boolean;
  mockWalletBalances: Record<string, number>;
  trackedTokens: TrackedToken[];
  refreshIntervalMs: number;
  priceService: TokenPriceService;
  gSwapOptions?: ConstructorParameters<typeof GSwap>[0];
  useMockFallback?: boolean;
}

export class WalletBalanceService {
  private readonly walletAddress: string;
  private readonly mockMode: boolean;
  private readonly mockWalletBalances: Record<string, number>;
  private readonly trackedTokens: TrackedToken[];
  private readonly refreshIntervalMs: number;
  private readonly priceService: TokenPriceService;
  private readonly isConfigured: boolean;
  private readonly gswap: GSwap | null;
  private readonly signer: PrivateKeySigner | null;
  private readonly useMockFallback: boolean;
  private cache: WalletBalanceCacheEntry | null = null;
  private inFlight: Promise<WalletBalanceOverview> | null = null;
  private lastErrorMessage: string | null = null;

  constructor(options: WalletBalanceServiceOptions) {
    this.walletAddress = options.walletAddress;
    this.mockMode = options.mockMode;
    this.mockWalletBalances = options.mockWalletBalances;
    this.trackedTokens = options.trackedTokens;
    this.refreshIntervalMs = Math.max(0, options.refreshIntervalMs);
    this.priceService = options.priceService;
    this.useMockFallback = options.useMockFallback ?? true;

    if (this.mockMode) {
      this.isConfigured = true;
      this.signer = null;
      this.gswap = null;
      return;
    }

    if (!this.walletAddress || !options.privateKey) {
      this.isConfigured = false;
      this.signer = null;
      this.gswap = null;
      return;
    }

    this.signer = new PrivateKeySigner(options.privateKey);
    const baseOptions = options.gSwapOptions ?? {};
    this.gswap = new GSwap({
      ...baseOptions,
      signer: this.signer,
      walletAddress: baseOptions.walletAddress ?? this.walletAddress,
    });
    this.isConfigured = true;
  }

  canProvideBalances(): boolean {
    return this.isConfigured;
  }

  async getOverview(forceRefresh: boolean = false): Promise<WalletBalanceOverview> {
    if (!this.isConfigured) {
      throw new Error('Wallet balances are not configured');
    }

    if (!forceRefresh && this.cache && !this.isCacheExpired(this.cache)) {
      return this.cache.data;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const request = this.fetchOverviewInternal()
      .then(overview => {
        this.cache = {
          data: overview,
          fetchedAt: Date.now(),
        };
        this.lastErrorMessage = null;
        return overview;
      })
      .catch(error => {
        this.lastErrorMessage = error instanceof Error ? error.message : 'Unknown wallet balance error';
        console.error('Failed to refresh wallet balances', error);

        const fallbackMap = this.useMockFallback ? this.buildMockBalanceMap() : null;
        if (fallbackMap && fallbackMap.size > 0) {
          return this.buildOverview(
            fallbackMap,
            true,
            this.lastErrorMessage
              ? `Live wallet balances unavailable (${this.lastErrorMessage}). Showing configured fallback balances.`
              : 'Live wallet balances unavailable. Showing configured fallback balances.',
          );
        }

        if (this.cache) {
          return {
            ...this.cache.data,
            isStale: true,
            warning:
              this.cache.data.warning ??
              (this.lastErrorMessage
                ? `Wallet balances may be out of date (${this.lastErrorMessage}). Showing cached values.`
                : 'Wallet balances may be out of date. Showing cached values.'),
          };
        }

        return this.buildOverview(
          new Map(),
          true,
          this.lastErrorMessage
            ? `Wallet balances are currently unavailable (${this.lastErrorMessage}).`
            : 'Wallet balances are currently unavailable.',
        );
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = request;
    return request;
  }

  private async fetchOverviewInternal(): Promise<WalletBalanceOverview> {
    const balancesBySymbol = await this.fetchBalances();
    return this.buildOverview(balancesBySymbol, false, null);
  }

  private async fetchBalances(): Promise<Map<string, number>> {
    if (this.mockMode) {
      return this.fetchMockBalances();
    }

    const client = this.gswap;
    if (!client) {
      return new Map<string, number>();
    }

    try {
      const response = (await client.assets.getUserAssets(this.walletAddress, 1, 20)) as {
        tokens?: Array<{ symbol?: string; quantity?: string }>;
      };

      const balances = new Map<string, number>();
      const tokens = response?.tokens ?? [];

      for (const token of tokens) {
        if (!token?.symbol) {
          continue;
        }

        const normalizedSymbol = token.symbol.toUpperCase();
        const rawQuantity = token.quantity ?? '0';
        const parsedQuantity = Number.parseFloat(rawQuantity);

        if (Number.isFinite(parsedQuantity)) {
          balances.set(normalizedSymbol, parsedQuantity);
        }
      }

      return balances;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch wallet balances: ${message}`);
    }
  }

  private fetchMockBalances(): Map<string, number> {
    const balances = new Map<string, number>();
    const entries = Object.entries(this.mockWalletBalances);

    for (const [tokenClass, quantity] of entries) {
      const symbol = tokenClass.split('|')[0]?.toUpperCase();
      if (!symbol) {
        continue;
      }

      if (!this.trackedTokens.some(token => token.symbol === symbol)) {
        continue;
      }

      const numericQuantity = typeof quantity === 'number' ? quantity : Number(quantity);
      if (!Number.isFinite(numericQuantity)) {
        continue;
      }

      balances.set(symbol, numericQuantity);
    }

    return balances;
  }

  private buildMockBalanceMap(): Map<string, number> {
    return this.fetchMockBalances();
  }

  private isCacheExpired(entry: WalletBalanceCacheEntry): boolean {
    if (this.refreshIntervalMs === 0) {
      return false;
    }

    return Date.now() - entry.fetchedAt >= this.refreshIntervalMs;
  }

  private async safeGetPriceUsd(symbol: string): Promise<number | null> {
    try {
      return await this.priceService.getPriceUsd(symbol);
    } catch (error) {
      return null;
    }
  }

  private async buildOverview(
    balancesBySymbol: Map<string, number>,
    isStale: boolean,
    warning: string | null,
  ): Promise<WalletBalanceOverview> {
    const balances = await Promise.all(
      this.trackedTokens.map(async token => {
        const symbol = token.symbol.toUpperCase();
        const balance = balancesBySymbol.get(symbol) ?? 0;
        const usdPrice = await this.safeGetPriceUsd(symbol);
        const usdValue = usdPrice !== null ? balance * usdPrice : null;

        return {
          symbol: token.symbol,
          tokenClass: token.tokenClass,
          balance,
          usdPrice,
          usdValue,
        };
      }),
    );

    const totalUsdValue = balances.reduce((sum, row) => {
      if (row.usdValue === null) {
        return sum;
      }
      return sum + row.usdValue;
    }, 0);

    const resolvedWarning =
      warning ?? this.lastErrorMessage ?? (isStale ? 'Wallet balances may be out of date.' : null);

    return {
      balances,
      totalUsdValue,
      lastUpdated: new Date().toISOString(),
      isStale,
      warning: resolvedWarning,
    };
  }
}
