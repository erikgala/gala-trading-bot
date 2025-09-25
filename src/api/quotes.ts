import type { QuoteMap } from './types';

export function buildQuoteCacheKey(
  inputTokenClass: string,
  outputTokenClass: string,
  inputAmount: number
): string {
  const key = `${inputTokenClass}::${outputTokenClass}::${inputAmount}`;
  return key;
}

export function cloneQuoteMap(quoteMap: QuoteMap): QuoteMap {
  return new Map(quoteMap);
}
