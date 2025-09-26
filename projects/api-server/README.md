# Monitoring API

A lightweight Express + WebSocket service that surfaces Gala trading bot activity from MongoDB.

## Scripts

```bash
npm run dev   # Start with ts-node-dev
npm run build # Generate production JS in dist/
npm start     # Run build output
```

## Environment

The service reuses the bot's Mongo connection string by default and honours the following variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | — | Mongo connection string (required for live data) |
| `MONGO_DB_NAME` | `trading-bot` | Database housing the trades collection |
| `MONGO_TRADES_COLLECTION` | `tradeExecutions` | Collection containing persisted trades |
| `MONITORING_API_PORT` | `4400` | HTTP/WebSocket port |
| `MONITORING_WS_PATH` | `/ws/trades` | WebSocket path |
| `MONITORING_RECENT_LIMIT` | `50` | Default number of recent trades to return |

The server will still start without MongoDB, but only health checks will be available.

## Endpoints

- `GET /health` – readiness + Mongo connectivity
- `GET /api/summary` – aggregated profit/loss
- `GET /api/trades/recent?limit=100` – latest trade executions
- `GET /api/trades/:executionId` – single trade lookup
- `WS {path}` – streaming updates (`trade`, `summary`, `error`, `init` messages)

## Deployment Notes

Run `npm run build` and point a process manager to `dist/index.js`. Remember to supply the same MongoDB credentials as the trading bot so both write/read from the same collection.
