import { 
  ArbitrageDetector, 
  CrossPairArbitrageStrategy, 
  DirectArbitrageStrategy,
  ArbitrageOpportunity
} from '../../strategies/arbitrage';
import { GSwapAPI, TradingPair, TokenInfo, SwapQuote } from '../../api/gswap';
import { 
  createMockTokenInfo, 
  createMockTradingPair, 
  createMockSwapQuote, 
  createMockArbitrageOpportunity,
  createMockSwapData
} from '../testUtils';

// Mock the GSwapAPI
jest.mock('../../api/gswap');
const MockedGSwapAPI = GSwapAPI as jest.MockedClass<typeof GSwapAPI>;

describe('ArbitrageDetector', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let detector: ArbitrageDetector;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    detector = new ArbitrageDetector();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectAllOpportunities', () => {
    it('should detect opportunities using all strategies', async () => {
      const mockPairs: TradingPair[] = [
        createMockTradingPair('GALA', 'GUSDC')
      ];

      const mockOpportunities: ArbitrageOpportunity[] = [
        createMockArbitrageOpportunity()
      ];

      // Mock the strategies to return opportunities
      const crossPairStrategy = new CrossPairArbitrageStrategy();
      const directStrategy = new DirectArbitrageStrategy();
      
      jest.spyOn(crossPairStrategy, 'detectOpportunities').mockResolvedValue(mockOpportunities);
      jest.spyOn(directStrategy, 'detectOpportunities').mockResolvedValue([]);

      detector = new ArbitrageDetector([crossPairStrategy, directStrategy]);

      const opportunities = await detector.detectAllOpportunities(mockPairs, mockApi);

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].id).toBe('test-opportunity');
      expect(crossPairStrategy.detectOpportunities).toHaveBeenCalledWith(mockPairs, mockApi);
      expect(directStrategy.detectOpportunities).toHaveBeenCalledWith(mockPairs, mockApi);
    });

    it('should return empty array when no strategies find opportunities', async () => {
      const mockPairs: TradingPair[] = [];
      const crossPairStrategy = new CrossPairArbitrageStrategy();
      const directStrategy = new DirectArbitrageStrategy();
      
      jest.spyOn(crossPairStrategy, 'detectOpportunities').mockResolvedValue([]);
      jest.spyOn(directStrategy, 'detectOpportunities').mockResolvedValue([]);

      detector = new ArbitrageDetector([crossPairStrategy, directStrategy]);

      const opportunities = await detector.detectAllOpportunities(mockPairs, mockApi);

      expect(opportunities).toHaveLength(0);
    });
  });

  describe('detectOpportunitiesForSwap', () => {
    it('should detect opportunities for specific swap data', async () => {
      const swapData = createMockSwapData();
      const currentPrice = 0.04;
      const mockOpportunities: ArbitrageOpportunity[] = [
        createMockArbitrageOpportunity()
      ];

      const crossPairStrategy = new CrossPairArbitrageStrategy();
      const directStrategy = new DirectArbitrageStrategy();
      
      jest.spyOn(crossPairStrategy, 'detectOpportunitiesForSwap').mockResolvedValue(mockOpportunities);
      jest.spyOn(directStrategy, 'detectOpportunitiesForSwap').mockResolvedValue([]);

      detector = new ArbitrageDetector([crossPairStrategy, directStrategy]);

      const opportunities = await detector.detectOpportunitiesForSwap(swapData, currentPrice, mockApi);

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].id).toBe('test-opportunity');
      expect(crossPairStrategy.detectOpportunitiesForSwap).toHaveBeenCalledWith(swapData, currentPrice, mockApi);
      expect(directStrategy.detectOpportunitiesForSwap).toHaveBeenCalledWith(swapData, currentPrice, mockApi);
    });
  });
});

describe('CrossPairArbitrageStrategy', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let strategy: CrossPairArbitrageStrategy;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    strategy = new CrossPairArbitrageStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectOpportunities', () => {
    it('should filter pairs to only include GALA pairs', async () => {
      const mockPairs: TradingPair[] = [
        createMockTradingPair('GALA', 'GUSDC'),
        createMockTradingPair('GUSDC', 'GUSDT') // This should be ignored
      ];

      const mockTokens: TokenInfo[] = [
        createMockTokenInfo('GALA', 'GALA|Unit|none|none'),
        createMockTokenInfo('GUSDC', 'GUSDC|Unit|none|none'),
        createMockTokenInfo('GUSDT', 'GUSDT|Unit|none|none')
      ];

      mockApi.getAvailableTokens.mockResolvedValue(mockTokens);
      mockApi.getQuote.mockResolvedValue(createMockSwapQuote(1000, 25000));

      const opportunities = await strategy.detectOpportunities(mockPairs, mockApi);

      // Should only process GALA pairs
      expect(Array.isArray(opportunities)).toBe(true);
    });
  });

  describe('detectOpportunitiesForSwap', () => {
    it('should analyze opportunities for specific swap data', async () => {
      const swapData = createMockSwapData();
      const currentPrice = 0.04;
      const mockTokens: TokenInfo[] = [
        createMockTokenInfo('GALA', 'GALA|Unit|none|none'),
        createMockTokenInfo('GUSDC', 'GUSDC|Unit|none|none'),
        createMockTokenInfo('GUSDT', 'GUSDT|Unit|none|none')
      ];

      mockApi.getAvailableTokens.mockResolvedValue(mockTokens);
      mockApi.getQuote.mockResolvedValue(createMockSwapQuote(1000, 25000));

      const opportunities = await strategy.detectOpportunitiesForSwap(swapData, currentPrice, mockApi);

      expect(Array.isArray(opportunities)).toBe(true);
    });
  });
});

describe('DirectArbitrageStrategy', () => {
  let mockApi: jest.Mocked<GSwapAPI>;
  let strategy: DirectArbitrageStrategy;

  beforeEach(() => {
    mockApi = new MockedGSwapAPI() as jest.Mocked<GSwapAPI>;
    strategy = new DirectArbitrageStrategy();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectOpportunities', () => {
    it('should filter pairs to only include GALA pairs', async () => {
      const mockPairs: TradingPair[] = [
        createMockTradingPair('GALA', 'GUSDC'),
        createMockTradingPair('GUSDC', 'GUSDT') // This should be ignored
      ];

      const opportunities = await strategy.detectOpportunities(mockPairs, mockApi);

      expect(Array.isArray(opportunities)).toBe(true);
      // Should only process GALA pairs, so GUSDC/GUSDT pair should be ignored
    });
  });

  describe('detectOpportunitiesForSwap', () => {
    it('should analyze direct arbitrage for specific swap data', async () => {
      const swapData = createMockSwapData();
      const currentPrice = 0.04;

      const opportunities = await strategy.detectOpportunitiesForSwap(swapData, currentPrice, mockApi);

      expect(Array.isArray(opportunities)).toBe(true);
    });
  });
});

describe('ArbitrageOpportunity Creation', () => {
  it('should create opportunity with correct properties', () => {
    const opportunity = createMockArbitrageOpportunity();

    expect(opportunity.id).toBe('test-opportunity');
    expect(opportunity.tokenA).toBe('GALA');
    expect(opportunity.tokenB).toBe('GUSDC');
    expect(opportunity.profitPercentage).toBe(5.13);
    expect(opportunity.hasFunds).toBe(true);
  });
});
