import http from 'http';
import path from 'path';
import fs from 'fs';

import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { MongoClient, Collection, ChangeStream, Document } from 'mongodb';
import { WebSocketServer, WebSocket } from 'ws';

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

interface PublicTradePayload {
  executionId: string;
  strategy: TradeDocument['strategy'];
  status: TradeDocument['status'];
  startTime: string;
  endTime: string | null;
  entryToken: TradeDocument['entryToken'];
  exitToken: TradeDocument['exitToken'];
  amount: TradeDocument['amount'];
  profit: TradeDocument['profit'] & { effective: number };
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

function mapTrade(trade: TradeDocument): PublicTradePayload {
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
      effective: calculateEffectiveProfit(trade),
    },
    balance: trade.balance,
    error: trade.error,
    environment: trade.environment,
  };
}

async function computeSummary(): Promise<ProfitSummary> {
  if (!tradeCollection) {
    throw new Error('MongoDB not initialised');
  }

  const pipeline = [
    {
      $group: {
        _id: null,
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

  const [result] = await tradeCollection.aggregate(pipeline).toArray();

  if (!result) {
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

  const totalProfit = typeof result.totalProfit === 'number' ? result.totalProfit : 0;
  const realizedProfit = typeof result.realizedProfit === 'number' ? result.realizedProfit : 0;
  const totalTrades = typeof result.totalTrades === 'number' ? result.totalTrades : 0;
  const profitableTrades = typeof result.profitableTrades === 'number' ? result.profitableTrades : 0;

  const averageProfitPerTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;
  const unrealizedProfit = totalProfit - realizedProfit;

  return {
    totalProfit,
    realizedProfit,
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

  return cursor.toArray();
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

      if (!['insert', 'update', 'replace'].includes(change.operationType)) {
        return;
      }

      const fullDocument = change.fullDocument ?? (await tradeCollection.findOne(change.documentKey as Document));
      if (!fullDocument) {
        return;
      }

      const trade = mapTrade(fullDocument as TradeDocument);
      latestSummary = await computeSummary();

      broadcast({
        type: 'trade',
        payload: {
          trade,
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

    res.json(mapTrade(trade));
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
