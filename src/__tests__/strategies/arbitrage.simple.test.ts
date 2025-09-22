import {
  ArbitrageDetector,
  ArbitrageOpportunity,
  SimpleArbitrageStrategy,
} from '../../strategies/arbitrage';
import { GSwapAPI, TradingPair, TokenInfo } from '../../api/gswap';
import type { BalanceSnapshot } from '../../api/gswap';
import {
  createMockArbitrageOpportunity,
  createMockTradingPair,
  createMockSwapData,
} from '../testUtils';

jest.mock('../../api/gswap');

const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

const { BalanceSnapshot: RealBalanceSnapshot, createTokenClassKey } = jest.requireActual<
  typeof import('../../api/gswap')
>('../../api/gswap');

const createMockBalanceSnapshot = (balances: Record<string, number>): BalanceSnapshot => {
  return new RealBalanceSnapshot(new Map(Object.entries(balances)), Date.now());
};

const buildQuote = (inputToken: string, outputToken: string, inputAmount: number, outputAmount: number) => ({
  inputToken,
  outputToken,
  inputAmount,
  outputAmount,
  priceImpact: 0,
  feeTier: 3000,
  route: [inputToken, outputToken],
});

describe('Simple arbitrage detection', () => {
  let api: jest.Mocked<GSwapAPI>;

  beforeEach(() => {
    api = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    api.createTokenClassKey.mockImplementation((data) => createTokenClassKey(data));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ArbitrageDetector', () => {
    const galaClass = 'GALA|Unit|none|none';
    const gusdcClass = 'GUSDC|Unit|none|none';

    let detector: ArbitrageDetector;

    beforeEach(() => {
      const snapshot = createMockBalanceSnapshot({
        [galaClass]: 1_000,
        [gusdcClass]: 5_000,
      });
      api.getBalanceSnapshot.mockResolvedValue(snapshot);
      api.checkTradingFunds.mockImplementation(async (amount, tokenClass) => ({
        hasFunds: true,
        currentBalance: snapshot.getBalance(tokenClass),
        shortfall: Math.max(0, amount - snapshot.getBalance(tokenClass)),
      }));

      detector = new ArbitrageDetector();
    });

    it('detects profitable round-trip opportunities across trading pairs', async () => {
      const pairs: TradingPair[] = [createMockTradingPair('GALA', 'GUSDC')];

      api.getQuote.mockImplementation(async (inputToken, outputToken, amount) => {
        if (inputToken === galaClass && outputToken === gusdcClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 5_000);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 5_000) {
          return buildQuote(inputToken, outputToken, amount, 1_010);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 180);
        }

        if (inputToken === galaClass && outputToken === gusdcClass && amount === 180) {
          return buildQuote(inputToken, outputToken, amount, 900);
        }

        return null;
      });

      const opportunities = await detector.detectAllOpportunities(pairs, api, new Map());

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].tokenA).toBe('GALA');
      expect(opportunities[0].tokenB).toBe('GUSDC');
      expect(opportunities[0].profitPercentage).toBeCloseTo(1, 5);
      expect(opportunities[0].estimatedProfit).toBeCloseTo(10, 5);
    });

    it('returns an empty list when no profitable cycle exists', async () => {
      const pairs: TradingPair[] = [createMockTradingPair('GALA', 'GUSDC')];

      api.getQuote.mockImplementation(async (inputToken, outputToken, amount) => {
        if (inputToken === galaClass && outputToken === gusdcClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 5_000);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 5_000) {
          return buildQuote(inputToken, outputToken, amount, 995);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 200);
        }

        if (inputToken === galaClass && outputToken === gusdcClass && amount === 200) {
          return buildQuote(inputToken, outputToken, amount, 950);
        }

        return null;
      });

      const opportunities = await detector.detectAllOpportunities(pairs, api, new Map());

      expect(opportunities).toHaveLength(0);
    });
  });

  describe('SimpleArbitrageStrategy', () => {
    const galaClass = 'GALA|Unit|none|none';
    const gusdcClass = 'GUSDC|Unit|none|none';

    let strategy: SimpleArbitrageStrategy;
    let snapshot: BalanceSnapshot;
    let tokenA: TokenInfo;
    let tokenB: TokenInfo;

    beforeEach(() => {
      snapshot = createMockBalanceSnapshot({
        [galaClass]: 1_000,
        [gusdcClass]: 5_000,
      });
      strategy = new SimpleArbitrageStrategy(snapshot);

      tokenA = {
        symbol: 'GALA',
        name: 'GALA',
        decimals: 18,
        tokenClass: galaClass,
        price: 0.04,
        priceChange24h: 0,
      };

      tokenB = {
        symbol: 'GUSDC',
        name: 'GUSDC',
        decimals: 6,
        tokenClass: gusdcClass,
        price: 1,
        priceChange24h: 0,
      };

      api.checkTradingFunds.mockImplementation(async (amount, tokenClass) => ({
        hasFunds: true,
        currentBalance: snapshot.getBalance(tokenClass),
        shortfall: Math.max(0, amount - snapshot.getBalance(tokenClass)),
      }));
    });

    it('builds opportunities when the round trip is profitable', async () => {
      api.getQuote.mockImplementation(async (inputToken, outputToken, amount) => {
        if (inputToken === galaClass && outputToken === gusdcClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 5_000);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 5_000) {
          return buildQuote(inputToken, outputToken, amount, 1_020);
        }

        return null;
      });

      const results = await strategy.detectOpportunities([
        { tokenA, tokenB, tokenClassA: galaClass, tokenClassB: gusdcClass },
      ], api);

      expect(results).toHaveLength(1);
      expect(results[0].estimatedProfit).toBeCloseTo(20, 5);
      expect(results[0].buyQuote.inputAmount).toBe(1_000);
      expect(results[0].sellQuote.inputAmount).toBe(5_000);
    });

    it('provides swap-focused opportunities using live swap data', async () => {
      api.getBalanceSnapshot.mockResolvedValue(snapshot);
      api.getTokenInfoByClassKey.mockResolvedValueOnce(tokenA).mockResolvedValueOnce(tokenB);

      api.getQuote.mockImplementation(async (inputToken, outputToken, amount) => {
        if (inputToken === galaClass && outputToken === gusdcClass && amount === 1_000) {
          return buildQuote(inputToken, outputToken, amount, 5_000);
        }

        if (inputToken === gusdcClass && outputToken === galaClass && amount === 5_000) {
          return buildQuote(inputToken, outputToken, amount, 1_015);
        }

        return null;
      });

      const detector = new ArbitrageDetector([SimpleArbitrageStrategy]);

      const opportunities = await detector.detectOpportunitiesForSwap(
        createMockSwapData(),
        0.04,
        api,
      );

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].currentMarketPrice).toBeCloseTo(0.04);
      expect(opportunities[0].confidence).toBeCloseTo(opportunities[0].profitPercentage, 5);
    });
  });
});

describe('ArbitrageOpportunity helpers', () => {
  it('creates mock opportunities with the expected defaults', () => {
    const opportunity: ArbitrageOpportunity = createMockArbitrageOpportunity();
    expect(opportunity.id).toBe('test-opportunity');
    expect(opportunity.tokenA).toBe('GALA');
    expect(opportunity.tokenB).toBe('GUSDC');
    expect(opportunity.hasFunds).toBe(true);
    expect(opportunity.estimatedProfit).toBeGreaterThan(0);
  });
});
