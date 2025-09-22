import { TradeExecutor, TradeExecution } from '../../trader/executor';
import { GSwapAPI } from '../../api/gswap';
import { ArbitrageOpportunity } from '../../strategies/arbitrage';
import {
  createMockArbitrageOpportunity,
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

  const createOpportunity = (): ArbitrageOpportunity => createMockArbitrageOpportunity();

  describe('constructor', () => {
    it('initializes with no active trades', () => {
      expect(executor.getActiveTrades()).toHaveLength(0);
    });
  });

  describe('executeArbitrage', () => {
    it('completes trade when both swaps succeed', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0x123', {
        inputAmount: opportunity.maxTradeAmount,
        outputAmount: opportunity.maxTradeAmount * 25,
      });
      const sellSwapResult = createMockSwapResult('0x456', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: buySwapResult.outputAmount + 500,
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
      const buySwapResult = createMockSwapResult('0xabc');

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockRejectedValueOnce(new Error('Sell swap failed'));

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Sell swap failed');
      expect(execution.buySwap).toEqual(buySwapResult);
      expect(execution.sellSwap).toBeUndefined();
    });

    it('cancels execution when trade is cancelled mid-flight', async () => {
      const opportunity = createOpportunity();
      const buySwapResult = createMockSwapResult('0x999');

      mockApi.executeSwap.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(buySwapResult), 25))
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
      executor.executeArbitrage(opportunity);

      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(1);
      expect(['pending', 'buying', 'selling', 'completed', 'failed', 'cancelled']).toContain(activeTrades[0].status);
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
        outputAmount: opportunity.maxTradeAmount * 25,
      });
      const sellSwapResult = createMockSwapResult('0x456', {
        inputAmount: buySwapResult.outputAmount,
        outputAmount: buySwapResult.outputAmount + 500,
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
