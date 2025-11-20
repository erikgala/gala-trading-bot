import { setTimeout as delay } from 'timers/promises';

type SupportedSymbol = 'GALA' | 'GUSDC' | 'GUSDT' | 'GWETH' | 'GWBTC' | 'GSOL' | 'BENE';

interface TokenPriceConfig {
  coingeckoId?: string;
  galaSwapId?: string;
  fallbackUsd?: number;
}

const TOKEN_PRICE_CONFIG: Record<SupportedSymbol, TokenPriceConfig> = {
  GALA: { coingeckoId: 'gala' },
  GUSDC: { coingeckoId: 'usd-coin', fallbackUsd: 1 },
  GUSDT: { coingeckoId: 'tether', fallbackUsd: 1 },
  GWETH: { coingeckoId: 'ethereum' },
  GWBTC: { coingeckoId: 'bitcoin' },
  GSOL: { coingeckoId: 'solana' },
  BENE: { galaSwapId: 'Token$Unit$BENE$client:5c806869e7fd0e2384461ce9' },
};

type PriceEntry = {
  usd: number;
  fetchedAt: number;
};

type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

interface TokenPriceServiceOptions {
  ttlMs?: number;
  fetchJson?: FetchJson;
  maxRetries?: number;
  retryDelayMs?: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 500;

function defaultFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Global fetch is not available in this environment.'));
  }

  return fetch(url, init).then(async response => {
    if (!response.ok) {
      throw new Error(`Failed to fetch token prices (${response.status})`);
    }

    return (await response.json()) as T;
  });
}

export class TokenPriceService {
  private readonly ttlMs: number;
  private readonly fetchJson: FetchJson;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private cache: Map<SupportedSymbol, PriceEntry> = new Map();
  private lastFetchError: Error | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: TokenPriceServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  getLastError(): Error | null {
    return this.lastFetchError;
  }

  async getPriceUsd(symbol: string): Promise<number | null> {
    const normalized = this.normalizeSymbol(symbol);
    if (!normalized) {
      return null;
    }

    await this.ensureFreshPrices();
    const entry = this.cache.get(normalized);

    if (entry && Number.isFinite(entry.usd) && entry.usd > 0) {
      return entry.usd;
    }

    return this.getFallbackPrice(normalized);
  }

  async getPriceMap(): Promise<Record<SupportedSymbol, number | null>> {
    await this.ensureFreshPrices();

    const result: Record<SupportedSymbol, number | null> = {
      GALA: null,
      GUSDC: null,
      GUSDT: null,
      GWETH: null,
      GWBTC: null,
      GSOL: null,
      BENE: null,
    };

    (Object.keys(TOKEN_PRICE_CONFIG) as SupportedSymbol[]).forEach(symbol => {
      const entry = this.cache.get(symbol);
      if (entry && Number.isFinite(entry.usd) && entry.usd > 0) {
        result[symbol] = entry.usd;
      } else {
        result[symbol] = this.getFallbackPrice(symbol);
      }
    });

    return result;
  }

  private normalizeSymbol(symbol: string): SupportedSymbol | null {
    const upper = symbol.toUpperCase();
    return (Object.keys(TOKEN_PRICE_CONFIG) as SupportedSymbol[]).find(token => token === upper) ?? null;
  }

  private isCacheFresh(): boolean {
    if (this.cache.size === 0) {
      return false;
    }

    const now = Date.now();
    return Array.from(this.cache.values()).every(entry => now - entry.fetchedAt < this.ttlMs);
  }

  private getFallbackPrice(symbol: SupportedSymbol): number | null {
    const config: TokenPriceConfig = TOKEN_PRICE_CONFIG[symbol];
    return typeof config.fallbackUsd === 'number' ? config.fallbackUsd : null;
  }

  private async ensureFreshPrices(): Promise<void> {
    if (this.isCacheFresh()) {
      return;
    }

    if (this.inFlight) {
      await this.inFlight;
      return;
    }

    this.inFlight = this.fetchAllPrices().finally(() => {
      this.inFlight = null;
    });

    await this.inFlight;
  }

  private async fetchAllPrices(): Promise<void> {

    // CoinGecko
    const ids = Array.from(new Set(
      (Object.values(TOKEN_PRICE_CONFIG) as Array<{ coingeckoId: string }>).filter(config => config.coingeckoId).map(config => config.coingeckoId),
    ));

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const data = await this.fetchJson<Record<string, { usd: number }>>(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
        });

        const now = Date.now();
        (Object.keys(TOKEN_PRICE_CONFIG) as SupportedSymbol[]).forEach(symbol => {
          const config = TOKEN_PRICE_CONFIG[symbol];
          const priceEntry = data[config.coingeckoId!];

          if (priceEntry && Number.isFinite(priceEntry.usd) && priceEntry.usd > 0) {
            this.cache.set(symbol, {
              usd: priceEntry.usd,
              fetchedAt: now,
            });
          }
        });

        this.lastFetchError = null;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Failed to fetch token prices');
        if (attempt < this.maxRetries) {
          await delay(this.retryDelayMs);
        }
      }
    }

    // GalaSwap
    await Promise.all(Object.entries(TOKEN_PRICE_CONFIG).filter(([_, config]) => config.galaSwapId).map(([symbol, config]) => this.fetchGalaSwapPrice(symbol as SupportedSymbol, config.galaSwapId!)));

    this.lastFetchError = lastError;
  }

  private async fetchGalaSwapPrice(symbol: SupportedSymbol, galaSwapId: string): Promise<void> {
    const url = `https://dex-backend-prod1.defi.gala.com/v1/trade/price?token=${galaSwapId}`;
    const data = await this.fetchJson<{ data: string }>(url);
    this.cache.set(symbol, { usd: parseFloat(data.data), fetchedAt: Date.now() });
  }
}

export type TokenPriceMap = Record<SupportedSymbol, number | null>;
