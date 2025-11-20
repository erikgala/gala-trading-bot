import { TokenInfo } from "../api/types";

type SymbolPair = readonly [string, string];

type ClassPair = readonly [string, string];

const toTokenClass = (symbol: string): string => {
  const test = SUPPORTED_TOKENS.find(token => token.symbol === symbol)?.tokenClass ?? '';
  return test;
};

export const SUPPORTED_TOKENS: TokenInfo[] = [
  { symbol: 'GALA', name: 'Gala', decimals: 8, tokenClass: 'GALA|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GUSDC', name: 'Gala USD Coin', decimals: 6, tokenClass: 'GUSDC|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GUSDT', name: 'Gala Tether', decimals: 6, tokenClass: 'GUSDT|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GWETH', name: 'Gala Wrapped Ethereum', decimals: 18, tokenClass: 'GWETH|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GWBTC', name: 'Gala Wrapped Bitcoin', decimals: 8, tokenClass: 'GWBTC|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'GSOL', name: 'Gala Wrapped Solana', decimals: 9, tokenClass: 'GSOL|Unit|none|none', price: 0, priceChange24h: 0 },
  { symbol: 'BENE', name: 'Benefactor', decimals: 9, tokenClass: 'Token|Unit|BENE|client:5c806869e7fd0e2384461ce9', price: 0, priceChange24h: 0 }
];

const SUPPORTED_SYMBOL_PAIRS: SymbolPair[] = [
  ['GALA', 'GUSDT'],
  ['GUSDT', 'GWETH'],
  ['GUSDC', 'GWETH'],
  ['GALA', 'GUSDC'],
  ['GSOL', 'GWBTC'],
  ['GUSDC', 'GWBTC'],
  ['GUSDT', 'GWBTC'],
  ['GALA', 'GWBTC'],
  ['GALA', 'GSOL'],
  ['GALA', 'BENE'],
  ['GWBTC','GWETH']
];

const SUPPORTED_TOKEN_CLASS_PAIRS: ClassPair[] = SUPPORTED_SYMBOL_PAIRS.map(([a, b]) => [
  toTokenClass(a),
  toTokenClass(b),
]);

const makePairKey = (tokenClassA: string, tokenClassB: string): string => {
  return [tokenClassA, tokenClassB].sort().join('::');
};

const SUPPORTED_PAIR_KEYS = new Set(SUPPORTED_TOKEN_CLASS_PAIRS.map(([a, b]) => makePairKey(a, b)));

export function isSupportedPair(tokenClassA: string, tokenClassB: string): boolean {
  return SUPPORTED_PAIR_KEYS.has(makePairKey(tokenClassA, tokenClassB));
}

export function getSupportedTokenClassPairs(): ClassPair[] {
  return [...SUPPORTED_SYMBOL_PAIRS];
}
