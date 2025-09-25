import type { Collection } from 'mongodb';
import type { SwapQuote, SwapResult } from '../api/gswap';
import { config } from '../config';
import { getMongoDatabase, isMongoConfigured } from '../db/mongoClient';
import type { DirectArbitrageOpportunity } from '../strategies/arbitrage';
import type { TriangularArbitrageOpportunity } from '../strategies/triangularArbitrage';
import type { TradeExecution } from './types';

export interface TradePersistence {
  record(execution: TradeExecution): Promise<void>;
}

interface DirectOpportunityDetails {
  token: {
    classA: string;
    classB: string;
    symbolA: string;
    symbolB: string;
  };
  buyPrice: number;
  sellPrice: number;
  quoteAToB: SwapQuote;
  quoteBToA: SwapQuote;
}

interface TriangularOpportunityDetails {
  referenceInputAmount: number;
  referenceOutputAmount: number;
  path: Array<{
    fromSymbol: string;
    fromTokenClass: string;
    toSymbol: string;
    toTokenClass: string;
    inputAmount: number;
    outputAmount: number;
    quote: SwapQuote;
  }>;
}

interface TradeDocument {
  executionId: string;
  opportunityId: string;
  strategy: 'direct' | 'triangular';
  status: TradeExecution['status'];
  startTime: Date;
  endTime: Date | null;
  durationMs: number | null;
  entryToken: { symbol: string; tokenClass: string };
  exitToken: { symbol: string; tokenClass: string };
  profit: {
    estimated: number;
    actual: number | null;
    percentage: number;
  };
  trades: {
    buy: SwapResult | null;
    sell: SwapResult | null;
    intermediate: SwapResult[];
  };
  amount: {
    maxTrade: number;
    buyInput: number | null;
    sellOutput: number | null;
  };
  balance: {
    hasFunds: boolean;
    currentBalance: number;
    shortfall: number;
  };
  opportunityTimestamp: Date;
  metrics: {
    currentMarketPrice: number | null;
    priceDiscrepancy: number | null;
    confidence: number | null;
  };
  strategyDetails: {
    direct: DirectOpportunityDetails | null;
    triangular: TriangularOpportunityDetails | null;
  };
  environment: {
    mockMode: boolean;
  };
  error: string | null;
  recordedAt: Date;
}

class NoopTradePersistence implements TradePersistence {
  async record(): Promise<void> {
    // Intentionally empty - used when MongoDB is not configured
  }
}

class MongoTradePersistence implements TradePersistence {
  private collectionPromise: Promise<Collection<TradeDocument>> | null = null;

  private async getCollection(): Promise<Collection<TradeDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        const db = await getMongoDatabase();
        const collection = db.collection<TradeDocument>(config.mongoTradesCollection);

        await Promise.allSettled([
          collection.createIndex({ executionId: 1 }, { unique: true, background: true }),
          collection.createIndex({ strategy: 1, startTime: -1 }, { background: true }),
        ]);

        return collection;
      })().catch(error => {
        this.collectionPromise = null;
        throw error;
      });
    }

    return this.collectionPromise;
  }

  async record(execution: TradeExecution): Promise<void> {
    const document = mapExecutionToDocument(execution);

    try {
      const collection = await this.getCollection();
      await collection.updateOne(
        { executionId: document.executionId },
        { $set: document },
        { upsert: true },
      );
    } catch (error) {
      console.error('⚠️  Failed to persist trade execution in MongoDB:', error);
    }
  }
}

export function createTradePersistence(): TradePersistence {
  if (!isMongoConfigured()) {
    return new NoopTradePersistence();
  }

  return new MongoTradePersistence();
}

function mapExecutionToDocument(execution: TradeExecution): TradeDocument {
  const { opportunity } = execution;
  const buySwap = serializeSwapResult(execution.buySwap);
  const sellSwap = serializeSwapResult(execution.sellSwap);
  const intermediateSwaps = (execution.intermediateSwaps ?? [])
    .map(serializeSwapResult)
    .filter((swap): swap is SwapResult => swap !== null);

  const baseDocument: TradeDocument = {
    executionId: execution.id,
    opportunityId: opportunity.id,
    strategy: opportunity.strategy,
    status: execution.status,
    startTime: new Date(execution.startTime),
    endTime: execution.endTime ? new Date(execution.endTime) : null,
    durationMs: execution.endTime ? execution.endTime - execution.startTime : null,
    entryToken: {
      symbol: opportunity.entryTokenSymbol,
      tokenClass: opportunity.entryTokenClass,
    },
    exitToken: {
      symbol: opportunity.exitTokenSymbol,
      tokenClass: opportunity.exitTokenClass,
    },
    profit: {
      estimated: opportunity.estimatedProfit,
      actual: execution.actualProfit ?? null,
      percentage: opportunity.profitPercentage,
    },
    trades: {
      buy: buySwap,
      sell: sellSwap,
      intermediate: intermediateSwaps,
    },
    amount: {
      maxTrade: opportunity.maxTradeAmount,
      buyInput: buySwap?.inputAmount ?? null,
      sellOutput: sellSwap?.outputAmount ?? null,
    },
    balance: {
      hasFunds: opportunity.hasFunds,
      currentBalance: opportunity.currentBalance,
      shortfall: opportunity.shortfall,
    },
    opportunityTimestamp: new Date(opportunity.timestamp),
    metrics: {
      currentMarketPrice: normalizeNumber(opportunity.currentMarketPrice),
      priceDiscrepancy: normalizeNumber(opportunity.priceDiscrepancy),
      confidence: normalizeNumber(opportunity.confidence),
    },
    strategyDetails: {
      direct: opportunity.strategy === 'direct' ? mapDirectDetails(opportunity) : null,
      triangular: opportunity.strategy === 'triangular' ? mapTriangularDetails(opportunity) : null,
    },
    environment: {
      mockMode: config.mockMode,
    },
    error: execution.error ?? null,
    recordedAt: new Date(),
  };

  return baseDocument;
}

function mapDirectDetails(opportunity: DirectArbitrageOpportunity): DirectOpportunityDetails {
  return {
    token: {
      classA: opportunity.tokenClassA,
      classB: opportunity.tokenClassB,
      symbolA: opportunity.tokenA,
      symbolB: opportunity.tokenB,
    },
    buyPrice: opportunity.buyPrice,
    sellPrice: opportunity.sellPrice,
    quoteAToB: serializeQuote(opportunity.quoteAToB),
    quoteBToA: serializeQuote(opportunity.quoteBToA),
  };
}

function mapTriangularDetails(opportunity: TriangularArbitrageOpportunity): TriangularOpportunityDetails {
  return {
    referenceInputAmount: opportunity.referenceInputAmount,
    referenceOutputAmount: opportunity.referenceOutputAmount,
    path: opportunity.path.map(leg => ({
      fromSymbol: leg.fromSymbol,
      fromTokenClass: leg.fromTokenClass,
      toSymbol: leg.toSymbol,
      toTokenClass: leg.toTokenClass,
      inputAmount: leg.inputAmount,
      outputAmount: leg.outputAmount,
      quote: serializeQuote(leg.quote),
    })),
  };
}

function serializeQuote(quote: SwapQuote): SwapQuote {
  return {
    inputToken: quote.inputToken,
    outputToken: quote.outputToken,
    inputAmount: quote.inputAmount,
    outputAmount: quote.outputAmount,
    priceImpact: quote.priceImpact,
    feeTier: quote.feeTier,
    route: [...quote.route],
  };
}

function serializeSwapResult(swap?: SwapResult): SwapResult | null {
  if (!swap) {
    return null;
  }

  return {
    transactionHash: swap.transactionHash,
    inputAmount: swap.inputAmount,
    outputAmount: swap.outputAmount,
    actualPrice: swap.actualPrice,
    gasUsed: swap.gasUsed,
    timestamp: swap.timestamp,
  };
}

function normalizeNumber(value: number | undefined | null): number | null {
  return Number.isFinite(value ?? NaN) ? (value as number) : null;
}
