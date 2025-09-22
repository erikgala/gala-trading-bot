import { TradeExecutor, TradeExecution } from '../../trader/executor';
import { GSwapAPI, SwapQuote } from '../../api/gswap';
import { DirectArbitrageOpportunity } from '../../strategies/arbitrage';
import {
  createMockArbitrageOpportunity,
  createMockTriangularOpportunity,
  createMockSwapResult,
  createMockSwapQuote,
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

  const primeQuotes = (
    opportunity: DirectArbitrageOpportunity,
    overrides: { buyQuote?: SwapQuote; sellQuote?: SwapQuote } = {}
  ): { buyQuote: SwapQuote; sellQuote: SwapQuote } => {
    const buyQuote = overrides.buyQuote ?? opportunity.quoteAToB;
    const sellQuote = overrides.sellQuote ?? opportunity.quoteBToA;

    mockApi.getQuote.mockResolvedValueOnce(buyQuote).mockResolvedValueOnce(sellQuote);

    return { buyQuote, sellQuote };
  };

  describe('constructor', () => {
    it('initializes with no active trades', () => {
      expect(executor.getActiveTrades()).toHaveLength(0);
    });
  });

  describe('executeArbitrage', () => {
    it('completes trade when both swaps succeed', async () => {
      const opportunity = createOpportunity();
      const { buyQuote, sellQuote } = primeQuotes(opportunity);
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

    it('fails trade when swap execution throws', async () => {
      const opportunity = createOpportunity();
      primeQuotes(opportunity);
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
      primeQuotes(opportunity);
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

    it('skips trade when refreshed quotes would lead to a loss', async () => {
      const opportunity = createOpportunity();
      const losingBuyQuote = createMockSwapQuote(
        opportunity.maxTradeAmount,
        opportunity.maxTradeAmount * 20,
        opportunity.tokenClassA,
        opportunity.tokenClassB
      );
      const losingSellQuote = createMockSwapQuote(
        losingBuyQuote.outputAmount,
        opportunity.maxTradeAmount * 0.9,
        opportunity.tokenClassB,
        opportunity.tokenClassA
      );

      primeQuotes(opportunity, { buyQuote: losingBuyQuote, sellQuote: losingSellQuote });

      const execution = await executor.executeArbitrage(opportunity);

      expect(execution.status).toBe('cancelled');
      expect(execution.error).toBe('Opportunity no longer profitable after re-quoting');
      expect(execution.buySwap).toBeUndefined();
      expect(execution.sellSwap).toBeUndefined();
      expect(execution.endTime).toBeDefined();
      expect(mockApi.executeSwap).not.toHaveBeenCalled();
      expect(mockApi.getQuote).toHaveBeenCalledTimes(2);
      expect(execution.opportunity.strategy).toBe('direct');
      if (execution.opportunity.strategy === 'direct') {
        expect(execution.opportunity.quoteAToB).toEqual(losingBuyQuote);
        expect(execution.opportunity.quoteBToA).toEqual(losingSellQuote);
      }
    });

    it('cancels execution when trade is cancelled mid-flight', async () => {
      const opportunity = createOpportunity();
      primeQuotes(opportunity);
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
      primeQuotes(opportunity);
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
      const triangularQuotes: SwapQuote[] = [
        createMockSwapQuote(opportunity.maxTradeAmount, 1100, 'GALA|Unit|none|none', 'GUSDC|Unit|none|none'),
        createMockSwapQuote(1100, 900, 'GUSDC|Unit|none|none', 'GWETH|Unit|none|none'),
        createMockSwapQuote(900, 1050, 'GWETH|Unit|none|none', 'GALA|Unit|none|none'),
      ];

      triangularQuotes.forEach(quote => mockApi.getQuote.mockResolvedValueOnce(quote));

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
      primeQuotes(opportunity);
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
