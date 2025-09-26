import { TriangularArbitrageDetector } from '../../strategies/triangularArbitrage';
import { GSwapAPI, TradingPair, QuoteMap } from '../../api/gswap';
import type { BalanceSnapshot } from '../../api/gswap';
import { buildQuoteCacheKey } from '../../api/quotes';
import { createMockTradingPair, createMockSwapQuote } from '../testUtils';

jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;
const { BalanceSnapshot: RealBalanceSnapshot } = jest.requireActual<
  typeof import('../../api/gswap')
>('../../api/gswap');

// Mock buildQuoteCacheKey to use the real implementation
jest.mock('../../api/quotes', () => ({
  ...jest.requireActual('../../api/quotes'),
}));

const GALA_CLASS = 'GALA|Unit|none|none';
const GUSDC_CLASS = 'GUSDC|Unit|none|none';
const GWBTC_CLASS = 'GWBTC|Unit|none|none';

function createSnapshot(balance: number = 10_000): BalanceSnapshot {
  const balances = new Map<string, number>([
    [GALA_CLASS, balance],
    [GUSDC_CLASS, balance],
    [GWBTC_CLASS, balance],
  ]);
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
    mockApi.checkTradingFunds.mockImplementation(async (requiredAmount, tokenClass) => {
      const currentBalance = balanceSnapshot.getBalance(tokenClass);
      return {
        hasFunds: currentBalance >= requiredAmount,
        currentBalance,
        shortfall: Math.max(0, requiredAmount - currentBalance),
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('detects profitable triangular opportunities', async () => {
    const pairs: TradingPair[] = [
      createMockTradingPair('GALA', 'GUSDC'),
      createMockTradingPair('GUSDC', 'GWBTC'),
      createMockTradingPair('GALA', 'GWBTC'),
    ];

    const quoteMap: QuoteMap = new Map();
    const now = Date.now();
    const ratioMap = new Map<string, number>([
      [`${GALA_CLASS}-${GUSDC_CLASS}`, 1.1],
      [`${GUSDC_CLASS}-${GALA_CLASS}`, 0.95],
      [`${GUSDC_CLASS}-${GWBTC_CLASS}`, 0.00005],
      [`${GWBTC_CLASS}-${GUSDC_CLASS}`, 21000],
      [`${GALA_CLASS}-${GWBTC_CLASS}`, 0.000048],
      [`${GWBTC_CLASS}-${GALA_CLASS}`, 22000],
    ]);

    const setQuote = (input: string, output: string, amount: number) => {
      const ratio = ratioMap.get(`${input}-${output}`);
      if (ratio === undefined) {
        return;
      }
      const quote = createMockSwapQuote(amount, amount * ratio, input, output);
      quoteMap.set(buildQuoteCacheKey(input, output, amount), { quote, timestamp: now });
    };

    for (const key of ratioMap.keys()) {
      const [input, output] = key.split('-');
      setQuote(input, output, 1);
    }

    mockApi.getQuote.mockImplementation(async (inputToken, outputToken, amount) => {
      const ratio = ratioMap.get(`${inputToken}-${outputToken}`);
      if (ratio === undefined) {
        return null;
      }
      return createMockSwapQuote(amount, amount * ratio, inputToken, outputToken);
    });

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
