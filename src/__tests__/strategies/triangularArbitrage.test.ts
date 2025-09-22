import { TriangularArbitrageDetector } from '../../strategies/triangularArbitrage';
import { GSwapAPI, TradingPair } from '../../api/gswap';
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
    ];

    mockApi.getQuote.mockImplementation(async (input, output, amount) => {
      if (input === GALA_CLASS && output === GUSDC_CLASS && amount === 1) {
        return createMockSwapQuote(1, 1.1, GALA_CLASS, GUSDC_CLASS);
      }

      if (
        input === GUSDC_CLASS &&
        output === GWETH_CLASS &&
        Math.abs(amount - 1.1) < 1e-6
      ) {
        return createMockSwapQuote(1.1, 0.9, GUSDC_CLASS, GWETH_CLASS);
      }

      if (input === GWETH_CLASS && output === GALA_CLASS && Math.abs(amount - 0.9) < 1e-6) {
        return createMockSwapQuote(0.9, 1.05, GWETH_CLASS, GALA_CLASS);
      }

      return null;
    });

    const opportunities = await detector.detectAllOpportunities(pairs, mockApi, new Map());

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
