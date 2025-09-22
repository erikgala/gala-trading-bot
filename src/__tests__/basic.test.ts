import { ArbitrageDetector } from '../strategies/arbitrage';
import { TradeExecutor } from '../trader/executor';
import { GSwapAPI } from '../api/gswap';
import { createMockArbitrageOpportunity, createMockSwapResult } from './testUtils';

// Mock the GSwapAPI
jest.mock('../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

describe('Basic Functionality Tests', () => {
  let mockApi: jest.Mocked<GSwapAPI>;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ArbitrageDetector', () => {
    it('should initialize correctly', () => {
      const detector = new ArbitrageDetector();
      expect(detector).toBeInstanceOf(ArbitrageDetector);
    });

    it('should have detectOpportunitiesForSwap method', () => {
      const detector = new ArbitrageDetector();
      expect(typeof detector.detectOpportunitiesForSwap).toBe('function');
    });

    it('should have detectAllOpportunities method', () => {
      const detector = new ArbitrageDetector();
      expect(typeof detector.detectAllOpportunities).toBe('function');
    });
  });

  describe('TradeExecutor', () => {
    let executor: TradeExecutor;

    beforeEach(() => {
      executor = new TradeExecutor(mockApi);
    });

    it('should initialize correctly', () => {
      expect(executor).toBeInstanceOf(TradeExecutor);
    });

    it('should have required methods', () => {
      expect(typeof executor.executeArbitrage).toBe('function');
      expect(typeof executor.cancelTradeExecution).toBe('function');
      expect(typeof executor.getActiveTrades).toBe('function');
      expect(typeof executor.getTradingCapacity).toBe('function');
      expect(typeof executor.getTradingStats).toBe('function');
    });

    it('should start with no active trades', () => {
      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(0);
    });

    it('should have correct initial trading capacity', () => {
      const capacity = executor.getTradingCapacity();
      expect(capacity.current).toBe(0);
      expect(capacity.max).toBe(3);
      expect(capacity.available).toBe(3);
    });

    it('should have correct initial trading stats', () => {
      const stats = executor.getTradingStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.completedTrades).toBe(0);
      expect(stats.failedTrades).toBe(0);
      expect(stats.totalProfit).toBe(0);
      expect(stats.averageProfit).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should return false for non-existent trade cancellation', async () => {
      const cancelled = await executor.cancelTradeExecution('non-existent-id');
      expect(cancelled).toBe(false);
    });

    it('should pass directionally correct quotes to executeSwap', async () => {
      const opportunity = createMockArbitrageOpportunity();

      mockApi.executeSwap.mockResolvedValueOnce(
        createMockSwapResult('0xbuy', {
          inputAmount: opportunity.maxTradeAmount,
          outputAmount: opportunity.quoteAToB.outputAmount,
        })
      );

      mockApi.executeSwap.mockResolvedValueOnce(
        createMockSwapResult('0xsell', {
          inputAmount: opportunity.quoteAToB.outputAmount,
          outputAmount: opportunity.quoteBToA.outputAmount,
        })
      );

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('completed');
      expect(mockApi.executeSwap).toHaveBeenCalledTimes(2);

      const [buyInputToken, buyOutputToken, buyInputAmount, , buyQuote] =
        mockApi.executeSwap.mock.calls[0];
      const [sellInputToken, sellOutputToken, sellInputAmount, , sellQuote] =
        mockApi.executeSwap.mock.calls[1];

      expect(buyInputToken).toBe(opportunity.tokenClassA);
      expect(buyOutputToken).toBe(opportunity.tokenClassB);
      expect(buyInputAmount).toBe(opportunity.maxTradeAmount);
      expect(buyQuote).toBe(opportunity.quoteAToB);
      expect(buyQuote?.inputToken).toBe(opportunity.tokenClassA);
      expect(buyQuote?.outputToken).toBe(opportunity.tokenClassB);

      expect(sellInputToken).toBe(opportunity.tokenClassB);
      expect(sellOutputToken).toBe(opportunity.tokenClassA);
      expect(sellInputAmount).toBe(opportunity.quoteAToB.outputAmount);
      expect(sellQuote).toBe(opportunity.quoteBToA);
      expect(sellQuote?.inputToken).toBe(opportunity.tokenClassB);
      expect(sellQuote?.outputToken).toBe(opportunity.tokenClassA);
    });
  });

  describe('Test Utilities', () => {
    it('should create mock arbitrage opportunity', () => {
      const opportunity = createMockArbitrageOpportunity();
      
      expect(opportunity).toBeDefined();
      expect(opportunity.id).toBe('test-opportunity');
      expect(opportunity.tokenA).toBe('GALA');
      expect(opportunity.tokenB).toBe('GUSDC');
      expect(opportunity.profitPercentage).toBe(5.13);
      expect(opportunity.hasFunds).toBe(true);
      expect(opportunity.quoteAToB).toBeDefined();
      expect(opportunity.quoteBToA).toBeDefined();
    });

    it('should create mock swap result', () => {
      const swapResult = createMockSwapResult('0x123');
      
      expect(swapResult).toBeDefined();
      expect(swapResult.transactionHash).toBe('0x123');
      expect(swapResult.inputAmount).toBe(1000);
      expect(swapResult.outputAmount).toBe(25000);
      expect(swapResult.actualPrice).toBe(0.04);
      expect(swapResult.gasUsed).toBe(100000);
      expect(swapResult.timestamp).toBeGreaterThan(0);
    });
  });
});
