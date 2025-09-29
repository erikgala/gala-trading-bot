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
  const balances = new Map<string, number>([
    ['GALA|Unit|none|none', balance],
    ['GUSDC|Unit|none|none', balance],
    ['GWBTC|Unit|none|none', balance],
  ]);
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

const TRADE_AMOUNT = 1000;
const PROFITABLE_BUY_OUTPUT = 27_000;
const PROFITABLE_SELL_OUTPUT = 1_100;

const mockDirectQuotes = (
  api: jest.Mocked<GSwapAPI>,
  buyOutput = PROFITABLE_BUY_OUTPUT,
  sellOutput = PROFITABLE_SELL_OUTPUT,
) => {
  api.getQuote.mockImplementation(async (input, output, amount) => {
    if (
      input === DIRECT_PAIR.tokenClassA &&
      output === DIRECT_PAIR.tokenClassB
    ) {
      // Scale the output based on the input amount
      const scaleFactor = amount / TRADE_AMOUNT;
      const scaledOutput = buyOutput * scaleFactor;
      return createQuote(DIRECT_PAIR.tokenClassA, DIRECT_PAIR.tokenClassB, amount, scaledOutput);
    }

    if (
      input === DIRECT_PAIR.tokenClassB &&
      output === DIRECT_PAIR.tokenClassA
    ) {
      // Scale the output based on the input amount
      const scaleFactor = amount / buyOutput;
      const scaledOutput = sellOutput * scaleFactor;
      return createQuote(DIRECT_PAIR.tokenClassB, DIRECT_PAIR.tokenClassA, amount, scaledOutput);
    }

    return null;
  });
};

const DIRECT_PAIR: TradingPair = createMockTradingPair('GALA', 'GUSDC');

describe('ArbitrageDetector', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let detector: ArbitrageDetector;
  let balanceSnapshot: BalanceSnapshot;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    balanceSnapshot = createMockBalanceSnapshot();

    mockApi.getBalanceSnapshot.mockResolvedValue(balanceSnapshot);
    mockApi.checkTradingFunds.mockImplementation(async (requiredAmount, tokenClass) => {
      const currentBalance = balanceSnapshot.getBalance(tokenClass);
      return {
        hasFunds: currentBalance >= requiredAmount,
        currentBalance,
        shortfall: Math.max(0, requiredAmount - currentBalance),
      };
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
    mockDirectQuotes(mockApi);

    const opportunities = await detector.detectOpportunitiesForSwap(swapData, 0.04, mockApi);

    expect(opportunities).toHaveLength(2);
    expect(opportunities.every(opp => opp.strategy === 'direct')).toBe(true);

    const entrySymbols = opportunities.map(opp =>
      opp.strategy === 'direct' ? opp.tokenA : opp.entryTokenSymbol,
    );

    expect(entrySymbols).toEqual(expect.arrayContaining(['GALA', 'GUSDC']));
    opportunities.forEach(opportunity => {
      expect(opportunity.profitPercentage).toBeGreaterThan(0);
    });
  });

  it('marks direct opportunities as funded when wallet balance is below max trade amount', async () => {
    balanceSnapshot = createMockBalanceSnapshot(100);
    mockApi.getBalanceSnapshot.mockResolvedValue(balanceSnapshot);

    const swapData = createMockSwapData();
    mockDirectQuotes(mockApi);

    const opportunities = await detector.detectOpportunitiesForSwap(swapData, 0.04, mockApi);

    expect(opportunities.length).toBeGreaterThan(0);
    const galaOpportunity = opportunities.find(
      opportunity => opportunity.strategy === 'direct' && opportunity.tokenA === 'GALA',
    );

    expect(galaOpportunity).toBeDefined();
    if (galaOpportunity && galaOpportunity.strategy === 'direct') {
      expect(galaOpportunity.hasFunds).toBe(true);
      const expectedTradeAmount = balanceSnapshot.getBalance('GALA|Unit|none|none') * 0.8;
      expect(galaOpportunity.maxTradeAmount).toBeCloseTo(expectedTradeAmount);
      expect(galaOpportunity.currentBalance).toBeCloseTo(balanceSnapshot.getBalance('GALA|Unit|none|none'));
      expect(galaOpportunity.shortfall).toBe(0);
    }
  });

  it('returns empty array when no profitable spread exists', async () => {
    const swapData = createMockSwapData();
    mockDirectQuotes(mockApi, 25_000, TRADE_AMOUNT);

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

    mockDirectQuotes(mockApi);

    const opportunity = await detector.evaluateSwapOperation(operation, mockApi);

    expect(opportunity).not.toBeNull();
    expect(opportunity?.strategy).toBe('direct');
    if (opportunity?.strategy === 'direct') {
      expect(opportunity.tokenA).toBe('GALA');
      expect(opportunity.tokenB).toBe('GUSDC');
    }
  });

  it('detects direct opportunities across trading pairs', async () => {
    mockDirectQuotes(mockApi);

    const opportunities = await detector.detectAllOpportunities([DIRECT_PAIR], mockApi, new Map());

    expect(opportunities).toHaveLength(2);
    opportunities.forEach(opportunity => {
      expect(opportunity.strategy).toBe('direct');
    });

    const forward = opportunities.find(
      opportunity => opportunity.strategy === 'direct' && opportunity.tokenClassA === 'GALA|Unit|none|none'
    );
    const reverse = opportunities.find(
      opportunity => opportunity.strategy === 'direct' && opportunity.tokenClassA === 'GUSDC|Unit|none|none'
    );

    expect(forward).toBeDefined();
    expect(reverse).toBeDefined();
  });

  it('ignores pairs that are not supported', async () => {
    const unsupportedPair = createMockTradingPair('GUSDC', 'GSOL');
    const opportunities = await detector.detectAllOpportunities([unsupportedPair], mockApi, new Map());
    expect(opportunities).toHaveLength(0);
  });
});

describe('ArbitrageOpportunity utility', () => {
  it('creates mock opportunity with expected properties', () => {
    const opportunity = createMockArbitrageOpportunity();

    expect(opportunity.id).toBe('test-opportunity');
    expect(opportunity.strategy).toBe('direct');
    if (opportunity.strategy === 'direct') {
      expect(opportunity.tokenA).toBe('GALA');
      expect(opportunity.tokenB).toBe('GUSDC');
    }
    expect(opportunity.profitPercentage).toBeGreaterThan(0);
    expect(opportunity.hasFunds).toBe(true);
  });
});
