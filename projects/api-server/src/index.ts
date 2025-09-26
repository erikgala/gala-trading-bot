import http from 'http';
import path from 'path';
import fs from 'fs';

import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import {
  MongoClient,
  Collection,
  ChangeStream,
  ChangeStreamInsertDocument,
  ChangeStreamReplaceDocument,
  ChangeStreamUpdateDocument,
  Document,
} from 'mongodb';
import { WebSocketServer, WebSocket } from 'ws';

import { TokenPriceService } from './tokenPriceService';

interface TradeDocument {
  executionId: string;
  strategy: 'direct' | 'triangular';
  status: string;
  startTime: Date;
  endTime: Date | null;
  entryToken: { symbol: string; tokenClass: string };
  exitToken: { symbol: string; tokenClass: string };
  amount: {
    maxTrade: number;
    buyInput: number | null;
    sellOutput: number | null;
  };
  profit: {
    estimated: number;
    actual: number | null;
    percentage: number;
  };
  balance: {
    hasFunds: boolean;
    currentBalance: number;
    shortfall: number;
  };
  environment: {
    mockMode: boolean;
  };
  error: string | null;
  recordedAt: Date;
}

interface ProfitOriginalAmounts {
  currency: string;
  estimated: number;
  actual: number | null;
  effective: number;
}

type PublicProfitPayload = TradeDocument['profit'] & {
  effective: number;
  currency: string;
  original?: ProfitOriginalAmounts;
};

interface PublicTradePayload {
  executionId: string;
  strategy: TradeDocument['strategy'];
  status: TradeDocument['status'];
  startTime: string;
  endTime: string | null;
  entryToken: TradeDocument['entryToken'];
  exitToken: TradeDocument['exitToken'];
  amount: TradeDocument['amount'];
  profit: PublicProfitPayload;
  balance: TradeDocument['balance'];
  error: TradeDocument['error'];
  environment: TradeDocument['environment'];
}

interface ProfitSummary {
  totalProfit: number;
  realizedProfit: number;
  unrealizedProfit: number;
  averageProfitPerTrade: number;
  totalTrades: number;
  profitableTrades: number;
  lastUpdated: string;
}

interface BroadcastMessage {
  type: 'init' | 'trade' | 'summary' | 'error';
  payload: unknown;
}

const logger = {
  info: (...args: unknown[]) => console.log('[monitoring-api]', ...args),
  warn: (...args: unknown[]) => console.warn('[monitoring-api]', ...args),
  error: (...args: unknown[]) => console.error('[monitoring-api]', ...args),
};

function loadEnvironment(): void {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../.env.local'),
  ];

  envCandidates.forEach(candidate => {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  });

  // Final fallback to default lookup
  dotenv.config({ override: false });
}

loadEnvironment();

const PORT = parseInt(process.env.MONITORING_API_PORT ?? '4400', 10);
const WS_PATH = process.env.MONITORING_WS_PATH ?? '/ws/trades';
const RECENT_LIMIT = parseInt(process.env.MONITORING_RECENT_LIMIT ?? '50', 10);
const MONGO_URI = process.env.MONGO_URI ?? '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'trading-bot';
const MONGO_TRADES_COLLECTION = process.env.MONGO_TRADES_COLLECTION ?? 'tradeExecutions';

if (!MONGO_URI) {
  logger.warn('MONGO_URI is not set. API server will start without database connectivity.');
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });
const clients = new Set<WebSocket>();
const priceService = new TokenPriceService();

let mongoClient: MongoClient | null = null;
let tradeCollection: Collection<TradeDocument> | null = null;
let changeStream: ChangeStream<TradeDocument> | null = null;
let latestSummary: ProfitSummary | null = null;

function calculateEffectiveProfit(trade: TradeDocument): number {
  const actual = trade.profit.actual ?? undefined;
  if (typeof actual === 'number' && Number.isFinite(actual)) {
    return actual;
  }

  return trade.profit.estimated;
}

function determineProfitCurrency(trade: TradeDocument): string {
  const exitSymbol = trade.exitToken?.symbol;
  if (exitSymbol && typeof exitSymbol === 'string') {
    return exitSymbol.toUpperCase();
  }

  const entrySymbol = trade.entryToken?.symbol;
  if (entrySymbol && typeof entrySymbol === 'string') {
    return entrySymbol.toUpperCase();
  }

  return 'USD';
}

function normalizeNumericValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (value && typeof (value as { toString: () => string }).toString === 'function') {
    const numeric = Number((value as { toString: () => string }).toString());
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
}

function mapTrade(trade: TradeDocument): PublicTradePayload {
  const effectiveProfit = calculateEffectiveProfit(trade);
  const profitCurrency = determineProfitCurrency(trade);

  return {
    executionId: trade.executionId,
    strategy: trade.strategy,
    status: trade.status,
    startTime: new Date(trade.startTime).toISOString(),
    endTime: trade.endTime ? new Date(trade.endTime).toISOString() : null,
    entryToken: trade.entryToken,
    exitToken: trade.exitToken,
    amount: trade.amount,
    profit: {
      ...trade.profit,
      effective: effectiveProfit,
      currency: profitCurrency,
    },
    balance: trade.balance,
    error: trade.error,
    environment: trade.environment,
  };
}

function cloneProfitOriginal(profit: PublicProfitPayload): ProfitOriginalAmounts {
  return {
    currency: profit.currency,
    estimated: profit.estimated,
    actual: profit.actual ?? null,
    effective: profit.effective,
  };
}

async function convertProfitToUsd(trade: PublicTradePayload): Promise<PublicTradePayload> {
  const currentCurrency = trade.profit.currency;

  if (currentCurrency === 'USD' && trade.profit.original) {
    return trade;
  }

  const original = cloneProfitOriginal(trade.profit);
  const priceUsd = await priceService.getPriceUsd(currentCurrency);

  if (priceUsd === null) {
    return {
      ...trade,
      profit: {
        ...trade.profit,
        original,
      },
    };
  }

  const convertNumber = (value: number): number => value * priceUsd;
  const convertNullable = (value: number | null): number | null => (value === null ? null : value * priceUsd);

  return {
    ...trade,
    profit: {
      ...trade.profit,
      estimated: convertNumber(original.estimated),
      actual: convertNullable(original.actual),
      effective: convertNumber(original.effective),
      currency: 'USD',
      original,
    },
  };
}

async function convertTradesToUsd(trades: PublicTradePayload[]): Promise<PublicTradePayload[]> {
  return Promise.all(trades.map(trade => convertProfitToUsd(trade)));
}

async function computeSummary(): Promise<ProfitSummary> {
  if (!tradeCollection) {
    throw new Error('MongoDB not initialised');
  }

  interface SummaryAggregationResult {
    _id: string | null;
    totalProfit: number;
    realizedProfit: number;
    totalTrades: number;
    profitableTrades: number;
  }

  const pipeline = [
    {
      $group: {
        _id: '$exitToken.symbol',
        totalProfit: {
          $sum: {
            $ifNull: ['$profit.actual', '$profit.estimated'],
          },
        },
        realizedProfit: {
          $sum: {
            $ifNull: ['$profit.actual', 0],
          },
        },
        totalTrades: { $sum: 1 },
        profitableTrades: {
          $sum: {
            $cond: [
              {
                $gt: [
                  {
                    $ifNull: ['$profit.actual', '$profit.estimated'],
                  },
                  0,
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const aggregation = await tradeCollection.aggregate<SummaryAggregationResult>(pipeline).toArray();

  if (aggregation.length === 0) {
    return {
      totalProfit: 0,
      realizedProfit: 0,
      unrealizedProfit: 0,
      averageProfitPerTrade: 0,
      totalTrades: 0,
      profitableTrades: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  let totalProfitUsd = 0;
  let realizedProfitUsd = 0;
  let totalTrades = 0;
  let profitableTrades = 0;

  for (const group of aggregation) {
    const symbol = typeof group._id === 'string' && group._id.length > 0 ? group._id : '';
    const normalizedSymbol = symbol.toUpperCase();
    const priceUsd = await priceService.getPriceUsd(normalizedSymbol);

    const totalProfit = normalizeNumericValue(group.totalProfit);
    const realizedProfit = normalizeNumericValue(group.realizedProfit);
    const groupTotalTrades = normalizeNumericValue(group.totalTrades);
    const groupProfitableTrades = normalizeNumericValue(group.profitableTrades);

    if (priceUsd === null) {
      logger.warn(`No USD price available for token ${normalizedSymbol || 'UNKNOWN'}; excluding from summary.`);
    } else {
      totalProfitUsd += totalProfit * priceUsd;
      realizedProfitUsd += realizedProfit * priceUsd;
    }

    totalTrades += groupTotalTrades;
    profitableTrades += groupProfitableTrades;
  }

  const averageProfitPerTrade = totalTrades > 0 ? totalProfitUsd / totalTrades : 0;
  const unrealizedProfit = totalProfitUsd - realizedProfitUsd;

  return {
    totalProfit: totalProfitUsd,
    realizedProfit: realizedProfitUsd,
    unrealizedProfit,
    averageProfitPerTrade,
    totalTrades,
    profitableTrades,
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchRecentTrades(limit = RECENT_LIMIT): Promise<PublicTradePayload[]> {
  if (!tradeCollection) {
    throw new Error('MongoDB not initialised');
  }

  const cursor = tradeCollection
    .find({}, { sort: { startTime: -1 }, limit })
    .map(mapTrade);

  const trades = await cursor.toArray();
  return convertTradesToUsd(trades);
}

function broadcast(message: BroadcastMessage): void {
  const encoded = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  });
}

async function initialiseMongo(): Promise<void> {
  if (!MONGO_URI) {
    return;
  }

  mongoClient = new MongoClient(MONGO_URI, { ignoreUndefined: true });
  await mongoClient.connect();
  const db = mongoClient.db(MONGO_DB_NAME);
  tradeCollection = db.collection<TradeDocument>(MONGO_TRADES_COLLECTION);
  latestSummary = await computeSummary();
  logger.info('Connected to MongoDB and ready to stream trade updates');

  try {
    changeStream = tradeCollection.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', async change => {
      if (!tradeCollection) {
        return;
      }

      if (
        change.operationType !== 'insert' &&
        change.operationType !== 'update' &&
        change.operationType !== 'replace'
      ) {
        return;
      }

      const changeWithDocument =
        change as
          | ChangeStreamInsertDocument<TradeDocument>
          | ChangeStreamUpdateDocument<TradeDocument>
          | ChangeStreamReplaceDocument<TradeDocument>;

      const fullDocument =
        changeWithDocument.fullDocument ??
        (await tradeCollection.findOne(changeWithDocument.documentKey as Document));
      if (!fullDocument) {
        return;
      }

      const trade = mapTrade(fullDocument as TradeDocument);
      const tradeWithUsd = await convertProfitToUsd(trade);
      latestSummary = await computeSummary();

      broadcast({
        type: 'trade',
        payload: {
          trade: tradeWithUsd,
          summary: latestSummary,
        },
      });
    });

    changeStream.on('error', error => {
      logger.error('Change stream error. Falling back to polling only:', error);
      changeStream?.close().catch(() => undefined);
      changeStream = null;
    });
  } catch (error) {
    logger.warn('MongoDB change streams are unavailable. Live updates will require manual refresh.', error);
    changeStream = null;
  }
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mongoConnected: Boolean(tradeCollection) });
});

app.get('/api/summary', async (_req: Request, res: Response) => {
  if (!tradeCollection) {
    res.status(503).json({ error: 'MongoDB not configured' });
    return;
  }

  try {
    latestSummary = await computeSummary();
    res.json(latestSummary);
  } catch (error) {
    logger.error('Failed to compute summary', error);
    res.status(500).json({ error: 'Failed to compute summary' });
  }
});

app.get('/api/trades/recent', async (req: Request, res: Response) => {
  if (!tradeCollection) {
    res.status(503).json({ error: 'MongoDB not configured' });
    return;
  }

  const limitParam = req.query.limit;
  const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : RECENT_LIMIT;

  try {
    const trades = await fetchRecentTrades(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 250) : RECENT_LIMIT);
    res.json(trades);
  } catch (error) {
    logger.error('Failed to fetch recent trades', error);
    res.status(500).json({ error: 'Failed to fetch recent trades' });
  }
});

app.get('/api/trades/:executionId', async (req: Request, res: Response) => {
  if (!tradeCollection) {
    res.status(503).json({ error: 'MongoDB not configured' });
    return;
  }

  try {
    const trade = await tradeCollection.findOne({ executionId: req.params.executionId });
    if (!trade) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    const mappedTrade = mapTrade(trade);
    const tradeWithUsd = await convertProfitToUsd(mappedTrade);
    res.json(tradeWithUsd);
  } catch (error) {
    logger.error('Failed to fetch trade by executionId', error);
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

wss.on('connection', async socket => {
  clients.add(socket);
  logger.info(`WebSocket client connected. Total clients: ${clients.size}`);

  socket.on('close', () => {
    clients.delete(socket);
    logger.info(`WebSocket client disconnected. Total clients: ${clients.size}`);
  });

  socket.on('error', error => {
    logger.warn('WebSocket client error', error);
  });

  if (!tradeCollection) {
    socket.send(
      JSON.stringify({
        type: 'error',
        payload: 'MongoDB not configured. Trade updates are unavailable.',
      }),
    );
    return;
  }

  try {
    const [trades, summary] = await Promise.all([
      fetchRecentTrades(),
      latestSummary ? Promise.resolve(latestSummary) : computeSummary(),
    ]);

    latestSummary = summary;

    const initPayload: BroadcastMessage = {
      type: 'init',
      payload: {
        trades,
        summary,
      },
    };

    socket.send(JSON.stringify(initPayload));
  } catch (error) {
    logger.error('Failed to send initial payload to WebSocket client', error);
    socket.send(
      JSON.stringify({
        type: 'error',
        payload: 'Failed to load initial trade data',
      }),
    );
  }
});

server.listen(PORT, async () => {
  logger.info(`Monitoring API listening on http://localhost:${PORT}`);
  logger.info(`WebSocket endpoint available at ws://localhost:${PORT}${WS_PATH}`);

  try {
    await initialiseMongo();
  } catch (error) {
    logger.error('Failed to initialise MongoDB connection', error);
  }
});

process.on('SIGINT', async () => {
  logger.info('Shutting down Monitoring API...');
  await changeStream?.close().catch(() => undefined);
  await mongoClient?.close().catch(() => undefined);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
