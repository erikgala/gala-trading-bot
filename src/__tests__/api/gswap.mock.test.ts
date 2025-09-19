jest.mock('@gala-chain/gswap-sdk', () => {
  const quoteExactInput = jest.fn();
  const swap = jest.fn();
  const getUserAssets = jest.fn();

  class MockGSwap {
    quoting = { quoteExactInput };
    swaps = { swap };
    assets = { getUserAssets };
  }

  return {
    GSwap: jest.fn(() => new MockGSwap()),
    PrivateKeySigner: jest.fn(),
    stringifyTokenClassKey: jest.fn(({ collection, category, type, additionalKey }) =>
      `${collection}|${category}|${type}|${additionalKey}`
    ),
    __mocks: {
      quoteExactInput,
      swap,
      getUserAssets,
    },
  };
});

describe('GSwapAPI mock mode behavior', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.PRIVATE_KEY = '0xabc';
    process.env.WALLET_ADDRESS = '0xwallet';
    process.env.MOCK_MODE = 'true';
    process.env.MOCK_WALLET_BALANCES = JSON.stringify({
      'GALA|Unit|none|none': 1000,
      'GUSDC|Unit|none|none': 0,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('executes swaps without calling on-chain swap and updates balances', async () => {
    const sdk = await import('@gala-chain/gswap-sdk');
    const { GSwapAPI } = await import('../../api/gswap');

    const quoteMock = (sdk as any).__mocks.quoteExactInput as jest.Mock;
    const swapMock = (sdk as any).__mocks.swap as jest.Mock;

    quoteMock.mockResolvedValue({
      outTokenAmount: { toNumber: () => 150 },
      priceImpact: { toNumber: () => 0.1 },
      feeTier: 0.003,
    });

    const api = new GSwapAPI();

    const result = await api.executeSwap('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

    expect(result.transactionHash).toMatch(/^mock_tx_/);
    expect(result.outputAmount).toBe(150);
    expect(swapMock).not.toHaveBeenCalled();

    const snapshot = await api.getBalanceSnapshot();
    expect(snapshot.getBalance('GALA|Unit|none|none')).toBeCloseTo(900);
    expect(snapshot.getBalance('GUSDC|Unit|none|none')).toBeCloseTo(150);
  });

  it('provides mock balances without querying chain assets', async () => {
    const sdk = await import('@gala-chain/gswap-sdk');
    const assetsMock = (sdk as any).__mocks.getUserAssets as jest.Mock;
    const { GSwapAPI } = await import('../../api/gswap');

    const api = new GSwapAPI();

    const snapshot = await api.getBalanceSnapshot(true);

    expect(snapshot.getBalance('GALA|Unit|none|none')).toBeCloseTo(1000);
    expect(snapshot.getBalance('GUSDC|Unit|none|none')).toBeCloseTo(0);
    expect(assetsMock).not.toHaveBeenCalled();
  });
});
