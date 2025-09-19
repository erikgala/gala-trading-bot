export declare class PrivateKeySigner {
  constructor(privateKey: string);
}

export declare class GSwap {
  constructor(config?: { signer?: PrivateKeySigner });
  assets: {
    getUserAssets(address: string, page: number, limit: number): Promise<unknown>;
  };
  quoting: {
    quoteExactInput(
      inputTokenClass: string,
      outputTokenClass: string,
      inputAmount: number
    ): Promise<{
      outTokenAmount: { toNumber(): number };
      priceImpact?: { toNumber(): number };
      feeTier: number;
    }>;
  };
  swaps: {
    swap(
      inputTokenClass: string,
      outputTokenClass: string,
      feeTier: number,
      swapParams: unknown,
      walletAddress: string
    ): Promise<unknown>;
  };
}

export declare function stringifyTokenClassKey(params: {
  collection?: string;
  category?: string;
  type?: string;
  additionalKey?: string;
}): string;
