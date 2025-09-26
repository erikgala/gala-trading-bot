type SymbolPair = readonly [string, string];

type ClassPair = readonly [string, string];

const toTokenClass = (symbol: string): string => `${symbol}|Unit|none|none`;

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
  return [...SUPPORTED_TOKEN_CLASS_PAIRS];
}
