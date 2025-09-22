import { ArbitrageDetector } from '../../strategies/arbitrage';
import { GSwapAPI, TradingPair, SwapQuote } from '../../api/gswap';
import type { BalanceSnapshot } from '../../api/gswap';
import type { DexV3Operation } from '../../streaming/types';

const { BalanceSnapshot: RealBalanceSnapshot } = jest.requireActual<
  typeof import('../../api/gswap')
>('../../api/gswap');
import {
  createMockArbitrageOpportunity,
  createMockTradingPair,
  createMockSwapData,
} from '../testUtils';

jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

const createMockBalanceSnapshot = (balance = 10_000): BalanceSnapshot => {
  const balances = new Map<string, number>([['GALA|Unit|none|none', balance]]);
  return new RealBalanceSnapshot(balances, Date.now());
};

const createQuote = (
  inputToken: string,
  outputToken: string,
  inputAmount: number,
  outputAmount: number
): SwapQuote => ({
  inputToken,
  outputToken,
  inputAmount,
  outputAmount,
  priceImpact: 0.1,
  feeTier: 3000,
  route: [inputToken, outputToken],
});

const DIRECT_PAIR: TradingPair = createMockTradingPair('GALA', 'GUSDC');

describe('ArbitrageDetector', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let detector: ArbitrageDetector;
  let balanceSnapshot: BalanceSnapshot;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    balanceSnapshot = createMockBalanceSnapshot();

    mockApi.getBalanceSnapshot.mockResolvedValue(balanceSnapshot);
    mockApi.checkTradingFunds.mockResolvedValue({
      hasFunds: true,
      currentBalance: balanceSnapshot.getBalance('GALA|Unit|none|none'),
      shortfall: 0,
    });
    mockApi.createTokenClassKey.mockImplementation(({ collection, category, type, additionalKey }) => (
      `${collection}|${category}|${type}|${additionalKey}`
    ));
    mockApi.isTokenAvailableByClassKey.mockReturnValue(true);

    detector = new ArbitrageDetector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('detects direct opportunities for swap data', async () => {
    const swapData = createMockSwapData();
    const quoteAB = createQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1, 27);
    const quoteBA = createQuote('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 27, 1.1);

    mockApi.getQuote
      .mockResolvedValueOnce(quoteAB)
      .mockResolvedValueOnce(quoteBA);

    const opportunities = await detector.detectOpportunitiesForSwap(swapData, 0.04, mockApi);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].tokenA).toBe('GALA');
    expect(opportunities[0].tokenB).toBe('GUSDC');
    expect(opportunities[0].profitPercentage).toBeGreaterThan(0);
  });

  it('returns empty array when no profitable spread exists', async () => {
    const swapData = createMockSwapData();
    const neutralQuoteAB = createQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1, 25);
    const neutralQuoteBA = createQuote('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 25, 1);

    mockApi.getQuote
      .mockResolvedValueOnce(neutralQuoteAB)
      .mockResolvedValueOnce(neutralQuoteBA);

    const opportunities = await detector.detectOpportunitiesForSwap(swapData, 0.04, mockApi);

    expect(opportunities).toHaveLength(0);
  });

  it('evaluates opportunities directly from swap operations', async () => {
    const operation: DexV3Operation = {
      method: 'Swap',
      uniqueId: 'operation-1',
      dto: {
        zeroForOne: true,
        token0: { collection: 'GALA', category: 'Unit', type: 'none', additionalKey: 'none' },
        token1: { collection: 'GUSDC', category: 'Unit', type: 'none', additionalKey: 'none' },
        amount: '1000',
        amountInMaximum: '1025',
        fee: 3000,
        sqrtPriceLimit: '0',
        recipient: '0xrecipient',
        signature: '0xsignature',
        uniqueKey: 'swap-key-1',
      },
    };

    const quoteAB = createQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1, 27);
    const quoteBA = createQuote('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 27, 1.1);

    mockApi.getQuote
      .mockResolvedValueOnce(quoteAB)
      .mockResolvedValueOnce(quoteBA);

    const opportunity = await detector.evaluateSwapOperation(operation, mockApi);

    expect(opportunity).not.toBeNull();
    expect(opportunity?.tokenA).toBe('GALA');
    expect(opportunity?.tokenB).toBe('GUSDC');
  });

  it('detects direct opportunities across trading pairs', async () => {
    const quoteAB = createQuote('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 1, 27);
    const quoteBA = createQuote('GUSDC|Unit|none|none', 'GALA|Unit|none|none', 27, 1.1);

    mockApi.getQuote
      .mockResolvedValueOnce(quoteAB)
      .mockResolvedValueOnce(quoteBA);

    const opportunities = await detector.detectAllOpportunities([DIRECT_PAIR], mockApi, new Map());

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].tokenClassA).toBe('GALA|Unit|none|none');
    expect(opportunities[0].tokenClassB).toBe('GUSDC|Unit|none|none');
  });

  it('ignores pairs that do not involve GALA', async () => {
    const nonGalaPair = createMockTradingPair('GUSDC', 'GUSDT');
    const opportunities = await detector.detectAllOpportunities([nonGalaPair], mockApi, new Map());
    expect(opportunities).toHaveLength(0);
  });
});

describe('ArbitrageOpportunity utility', () => {
  it('creates mock opportunity with expected properties', () => {
    const opportunity = createMockArbitrageOpportunity();

    expect(opportunity.id).toBe('test-opportunity');
    expect(opportunity.tokenA).toBe('GALA');
    expect(opportunity.tokenB).toBe('GUSDC');
    expect(opportunity.profitPercentage).toBeGreaterThan(0);
    expect(opportunity.hasFunds).toBe(true);
  });
});
