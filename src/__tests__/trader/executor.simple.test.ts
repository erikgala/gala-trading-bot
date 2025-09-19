import { TradeExecutor, TradeExecution } from '../../trader/executor';
import { GSwapAPI, SwapResult } from '../../api/gswap';
import { ArbitrageOpportunity } from '../../strategies/arbitrage';
import { 
  createMockArbitrageOpportunity, 
  createMockSwapResult 
} from '../testUtils';

// Mock the GSwapAPI
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

  describe('constructor', () => {
    it('should initialize with empty active trades', () => {
      expect(executor.getActiveTrades()).toHaveLength(0);
    });
  });

  describe('executeArbitrage', () => {
    it('should create trade execution and add to active trades', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const mockSwapResult = createMockSwapResult('0x123');

      mockApi.executeSwap.mockResolvedValue(mockSwapResult);

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution).toBeDefined();
      expect(execution.id).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(execution.opportunity).toBe(opportunity);
      expect(execution.status).toBe('completed');
      expect(execution.startTime).toBeGreaterThan(0);
      expect(execution.endTime).toBeGreaterThanOrEqual(execution.startTime);
      expect(execution.buySwap).toBeDefined();
      expect(execution.sellSwap).toBeDefined();
      expect(execution.actualProfit).toBeDefined();

      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(1);
      expect(activeTrades[0].id).toBe(execution.id);
    }, 10000);

    it('should handle swap execution failure', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const error = new Error('Swap execution failed');

      mockApi.executeSwap.mockRejectedValue(error);

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Swap execution failed');
      expect(execution.endTime).toBeDefined();
    }, 10000);

    it('should handle buy swap failure', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const error = new Error('Buy swap failed');

      mockApi.executeSwap
        .mockRejectedValueOnce(error) // Buy swap fails
        .mockResolvedValueOnce(createMockSwapResult('0x456')); // Sell swap would succeed but won't be called

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Buy swap failed');
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
    }, 10000);

    it('should handle sell swap failure after successful buy', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const buySwapResult = createMockSwapResult('0x123');
      const sellError = new Error('Sell swap failed');

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult) // Buy swap succeeds
        .mockRejectedValueOnce(sellError); // Sell swap fails

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('failed');
      expect(execution.error).toBe('Sell swap failed');
      expect(execution.buySwap).toBeDefined();
      expect(execution.sellSwap).toBeUndefined();
    }, 10000);

    it('should calculate actual profit correctly', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const buySwapResult = createMockSwapResult('0x123');
      const sellSwapResult = createMockSwapResult('0x456');

      mockApi.executeSwap
        .mockResolvedValueOnce(buySwapResult)
        .mockResolvedValueOnce(sellSwapResult);

      const execution = await executor.executeArbitrage(opportunity);

      expect(mockApi.executeSwap).toHaveBeenCalledTimes(2);
      expect(execution.buySwap).toBeDefined();
      expect(execution.sellSwap).toBeDefined();
      expect(execution.status).toBe('completed');
    }, 10000);
  });

  describe('cancelTradeExecution', () => {
    it('should cancel pending trade', async () => {
      const opportunity = createMockArbitrageOpportunity();
      
      // Start execution but don't await it
      const executionPromise = executor.executeArbitrage(opportunity);
      
      // Get the execution ID from active trades
      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(1);
      const executionId = activeTrades[0].id;

      // Cancel the trade
      const cancelled = await executor.cancelTradeExecution(executionId);
      expect(cancelled).toBe(true);

      // Wait for the execution to complete
      await executionPromise;

      const finalTrades = executor.getActiveTrades();
      const finalExecution = finalTrades.find(t => t.id === executionId);
      expect(finalExecution?.status).toBe('cancelled');
    }, 10000);

    it('should return false for non-existent trade', async () => {
      const cancelled = await executor.cancelTradeExecution('non-existent-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('getActiveTrades', () => {
    it('should return empty array when no active trades', () => {
      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(0);
    });

    it('should return active trades', async () => {
      const opportunity = createMockArbitrageOpportunity();
      
      // Start execution but don't await it
      executor.executeArbitrage(opportunity);

      const activeTrades = executor.getActiveTrades();
      expect(activeTrades).toHaveLength(1);
      expect(['pending', 'buying', 'selling']).toContain(activeTrades[0].status);
    });
  });

  describe('getTradingCapacity', () => {
    it('should return correct capacity when no active trades', () => {
      const capacity = executor.getTradingCapacity();
      expect(capacity.current).toBe(0);
      expect(capacity.max).toBe(3); // Default from config
      expect(capacity.available).toBe(3);
    });

    it('should return correct capacity with active trades', async () => {
      const opportunity = createMockArbitrageOpportunity();
      
      // Start execution but don't await it
      executor.executeArbitrage(opportunity);

      const capacity = executor.getTradingCapacity();
      expect(capacity.current).toBe(1);
      expect(capacity.max).toBe(3);
      expect(capacity.available).toBe(2);
    });
  });

  describe('getTradingStats', () => {
    it('should return zero stats when no trades', () => {
      const stats = executor.getTradingStats();
      expect(stats.totalTrades).toBe(0);
      expect(stats.completedTrades).toBe(0);
      expect(stats.failedTrades).toBe(0);
      expect(stats.totalProfit).toBe(0);
      expect(stats.averageProfit).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should calculate stats correctly after trades', async () => {
      const opportunity = createMockArbitrageOpportunity();
      const mockSwapResult = createMockSwapResult('0x123');

      mockApi.executeSwap.mockResolvedValue(mockSwapResult);

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
    it('should have correct structure', () => {
      const execution: TradeExecution = {
        id: 'test-execution',
        opportunity: createMockArbitrageOpportunity(),
        status: 'pending',
        startTime: Date.now()
      };

      expect(execution.id).toBe('test-execution');
      expect(execution.status).toBe('pending');
      expect(execution.startTime).toBeGreaterThan(0);
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
      expect(execution.actualProfit).toBeUndefined();
      expect(execution.error).toBeUndefined();
    });
  });
});
