import { TriangularArbitrageDetector } from '../../strategies/triangularArbitrage';
import { GSwapAPI, TradingPair, buildQuoteCacheKey, QuoteMap } from '../../api/gswap';
import type { BalanceSnapshot } from '../../api/gswap';
import { createMockTradingPair, createMockSwapQuote } from '../testUtils';

jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;
const { BalanceSnapshot: RealBalanceSnapshot } = jest.requireActual<
  typeof import('../../api/gswap')
>('../../api/gswap');

const GALA_CLASS = 'GALA|Unit|none|none';
const GUSDC_CLASS = 'GUSDC|Unit|none|none';
const GWETH_CLASS = 'GWETH|Unit|none|none';

function createSnapshot(balance: number = 10_000): BalanceSnapshot {
  const balances = new Map<string, number>([[GALA_CLASS, balance]]);
  return new RealBalanceSnapshot(balances, Date.now());
}

describe('TriangularArbitrageDetector', () => {
  let detector: TriangularArbitrageDetector;
  let mockApi: jest.Mocked<GSwapAPI>;
  let balanceSnapshot: BalanceSnapshot;

  beforeEach(() => {
    detector = new TriangularArbitrageDetector();
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    balanceSnapshot = createSnapshot();

    mockApi.getBalanceSnapshot.mockResolvedValue(balanceSnapshot);
    mockApi.checkTradingFunds.mockResolvedValue({
      hasFunds: true,
      currentBalance: balanceSnapshot.getBalance(GALA_CLASS),
      shortfall: 0,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('detects profitable triangular opportunities', async () => {
    const pairs: TradingPair[] = [
      createMockTradingPair('GALA', 'GUSDC'),
      createMockTradingPair('GALA', 'GWETH'),
      createMockTradingPair('GUSDC', 'GWETH'),
    ];

    const quoteMap: QuoteMap = new Map();
    const now = Date.now();
    const setQuote = (input: string, output: string, amount: number, resultAmount: number) => {
      const quote = createMockSwapQuote(amount, resultAmount, input, output);
      quoteMap.set(buildQuoteCacheKey(input, output, amount), { quote, timestamp: now });
    };

    setQuote(GALA_CLASS, GUSDC_CLASS, 1, 1.1);
    setQuote(GUSDC_CLASS, GWETH_CLASS, 1.1, 0.9);
    setQuote(GWETH_CLASS, GALA_CLASS, 0.9, 1.05);

    setQuote(GALA_CLASS, GUSDC_CLASS, 1000, 1100);
    setQuote(GUSDC_CLASS, GWETH_CLASS, 1100, 900);
    setQuote(GWETH_CLASS, GALA_CLASS, 900, 1050);

    mockApi.getQuote.mockImplementation(async () => null);

    const opportunities = await detector.detectAllOpportunities(pairs, mockApi, quoteMap);

    expect(opportunities.length).toBeGreaterThanOrEqual(1);
    const opportunity = opportunities[0];
    expect(opportunity.strategy).toBe('triangular');
    expect(opportunity.path).toHaveLength(3);
    expect(opportunity.profitPercentage).toBeGreaterThan(0);
  });

  it('returns empty array when insufficient tokens available', async () => {
    const pairs: TradingPair[] = [createMockTradingPair('GALA', 'GUSDC')];
    const opportunities = await detector.detectAllOpportunities(pairs, mockApi, new Map());
    expect(opportunities).toHaveLength(0);
  });
});
