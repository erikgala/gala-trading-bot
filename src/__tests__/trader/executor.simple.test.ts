import { TradeExecutor, TradeExecution } from '../../trader/executor';
import { GSwapAPI } from '../../api/gswap';
import { DirectArbitrageOpportunity } from '../../strategies/arbitrage';
import {
  createMockArbitrageOpportunity,
  createMockTriangularOpportunity,
  createMockSwapResult,
} from '../testUtils';

jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

describe('TradeExecutor', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let executor: TradeExecutor;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    executor = new TradeExecutor(mockApi);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createOpportunity = (): DirectArbitrageOpportunity => createMockArbitrageOpportunity();

  describe('constructor', () => {
    it('initializes with no active trades', () => {
      expect(executor.getActiveTrades()).toHaveLength(0);
    });
  });

  describe('executeArbitrage', () => {
    it('completes trade when both swaps succeed', async () => {
      const opportunity = createOpportunity();
      const { quoteAToB: buyQuote, quoteBToA: sellQuote } = opportunity;
      const buySwapResult = createMockSwapResult('0x123', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: buyQuote.outputAmount,
      });
      const sellSwapResult = createMockSwapResult('0x456', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: sellQuote.outputAmount,
      });

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockResolvedValueOnce(sellSwapResult);

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('completed');
      expect(execution.buySwap).toEqual(buySwapResult);
      expect(execution.sellSwap).toEqual(sellSwapResult);
      expect(execution.actualProfit).toBe(sellSwapResult.outputAmount - buySwapResult.inputAmount);
      expect(execution.endTime).toBeDefined();
      expect(mockApi.executeSwap).toHaveBeenCalledTimes(2);
      expect(mockApi.executeSwap).toHaveBeenNthCalledWith(
        1,
        opportunity.tokenClassA,
        opportunity.tokenClassB,
        opportunity.maxTradeAmount,
        expect.any(Number),
        buyQuote
      );
      expect(mockApi.executeSwap).toHaveBeenNthCalledWith(
        2,
        opportunity.tokenClassB,
        opportunity.tokenClassA,
        buySwapResult.outputAmount,
        expect.any(Number),
        sellQuote
      );
    });

    it('releases capacity and records history after a completed trade', async () => {
      const opportunity = createOpportunity();
      const { quoteAToB: buyQuote, quoteBToA: sellQuote } = opportunity;
      const buySwapResult = createMockSwapResult('0xhist1', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: buyQuote.outputAmount,
      });
      const sellSwapResult = createMockSwapResult('0xhist2', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: sellQuote.outputAmount,
      });

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockResolvedValueOnce(sellSwapResult);

      const execution = await executor.executeArbitrage(opportunity);

      expect(executor.getActiveTrades()).toHaveLength(0);
      expect(executor.canExecuteTrade()).toBe(true);

      const history = executor.getTradeHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: execution.id, status: 'completed' }),
        ]),
      );

      const retrieved = executor.getTradeExecution(execution.id);
      expect(retrieved).toMatchObject({ id: execution.id, status: 'completed' });
    });

    it('fails trade when swap execution throws', async () => {
      const opportunity = createOpportunity();
      mockApi.executeSwap.mockRejectedValue(new Error('Swap execution failed'));

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Swap execution failed');
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
      expect(execution.endTime).toBeDefined();
    });

    it('fails trade when sell swap fails', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0xabc', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: opportunity.quoteAToB.outputAmount,
      });

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockRejectedValueOnce(new Error('Sell swap failed'));

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Sell swap failed');
      expect(execution.buySwap).toEqual(buySwapResult);
      expect(execution.sellSwap).toBeUndefined();
    });

    it('skips trade when opportunity profit is below the threshold', async () => {
      const opportunity: DirectArbitrageOpportunity = {
        ...createOpportunity(),
        estimatedProfit: -10,
        profitPercentage: -1,
      };

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('cancelled');
      expect(execution.error).toBe('Opportunity no longer meets profit requirements');
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
      expect(execution.endTime).toBeDefined();
      expect(mockApi.executeSwap).not.toHaveBeenCalled();
    });

    it('cancels execution when trade is cancelled mid-flight', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0x999', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: opportunity.quoteAToB.outputAmount,
      });

      mockApi.executeSwap.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(buySwapResult), 25))
      );

      const executionPromise = executor.executeArbitrage(opportunity);
      const [activeExecution] = executor.getActiveTrades();
      expect(activeExecution).toBeDefined();

      await executor.cancelTradeExecution(activeExecution.id);

      const execution = await executionPromise;
      expect(execution.status).toBe('cancelled');
      expect(execution.error).toBe('Trade cancelled');
    });
  });

  describe('cancelTradeExecution', () => {
    it('returns false when trade does not exist', async () => {
      await expect(executor.cancelTradeExecution('missing')).resolves.toBe(false);
    });
  });

  describe('getActiveTrades', () => {
    it('returns active executions', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0xactive1', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: opportunity.quoteAToB.outputAmount,
      });
      const sellSwapResult = createMockSwapResult('0xactive2', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: opportunity.quoteBToA.outputAmount,
      });

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockResolvedValueOnce(sellSwapResult);

      executor.executeArbitrage(opportunity);

      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(1);
      expect(['pending', 'buying', 'selling', 'converting', 'completed', 'failed', 'cancelled']).toContain(
        activeTrades[0].status,
      );
    });
  });

  describe('triangular arbitrage execution', () => {
    it('executes all legs successfully', async () => {
      const opportunity = createMockTriangularOpportunity();
      const swapResults = [
        createMockSwapResult('0xleg1', { inputAmount: opportunity.maxTradeAmount, outputAmount: 1100 }),
        createMockSwapResult('0xleg2', { inputAmount: 1100, outputAmount: 900 }),
        createMockSwapResult('0xleg3', { inputAmount: 900, outputAmount: 1050 }),
      ];

      swapResults.forEach(result => mockApi.executeSwap.mockResolvedValueOnce(result));

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('completed');
      expect(execution.buySwap).toEqual(swapResults[0]);
      expect(execution.intermediateSwaps).toHaveLength(1);
      expect(execution.intermediateSwaps?.[0]).toEqual(swapResults[1]);
      expect(execution.sellSwap).toEqual(swapResults[2]);
      expect(execution.actualProfit).toBeCloseTo(50, 5);
      expect(mockApi.executeSwap).toHaveBeenCalledTimes(3);
    });
  });

  describe('getTradingCapacity', () => {
    it('reflects current usage', () => {
      const capacity = executor.getTradingCapacity();
      expect(capacity.current).toBe(0);
      expect(capacity.max).toBe(3);
      expect(capacity.available).toBe(3);
    });
  });

  describe('getTradingStats', () => {
    it('returns zeroed stats when no trades executed', () => {
      const stats = executor.getTradingStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.completedTrades).toBe(0);
      expect(stats.failedTrades).toBe(0);
      expect(stats.totalProfit).toBe(0);
      expect(stats.averageProfit).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('updates stats after successful trade', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0x123', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: opportunity.quoteAToB.outputAmount,
      });
      const sellSwapResult = createMockSwapResult('0x456', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: opportunity.quoteBToA.outputAmount,
      });

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockResolvedValueOnce(sellSwapResult);

      await executor.executeArbitrage(opportunity);
      const stats = executor.getTradingStats();

      expect(stats.totalTrades).toBe(1);
      expect(stats.completedTrades).toBe(1);
      expect(stats.failedTrades).toBe(0);
      expect(stats.totalProfit).toBeGreaterThan(0);
      expect(stats.averageProfit).toBeGreaterThan(0);
      expect(stats.successRate).toBe(100);
    });
  });

  describe('TradeExecution interface', () => {
    it('matches expected structure', () => {
      const execution: TradeExecution = {
        id: 'test-execution',
        opportunity: createOpportunity(),
        status: 'pending',
        startTime: Date.now(),
      };

      expect(execution.id).toBe('test-execution');
      expect(execution.status).toBe('pending');
      expect(execution.startTime).toBeGreaterThan(0);
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
      expect(execution.actualProfit).toBeUndefined();
    });
  });
});
