import type { QuoteMap } from './types';

export function buildQuoteCacheKey(
  inputTokenClass: string,
  outputTokenClass: string,
  inputAmount: number
): string {
  return `${inputTokenClass}::${outputTokenClass}::${inputAmount}`;
}

export function cloneQuoteMap(quoteMap: QuoteMap): QuoteMap {
  return new Map(quoteMap);
}
