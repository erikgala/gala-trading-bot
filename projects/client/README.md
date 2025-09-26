# Monitoring Client

A Vite + React dashboard that visualises live trade executions and profit metrics streamed from the monitoring API.

## Scripts

```bash
npm run dev      # Start vite dev server (default: http://localhost:5173)
npm run build    # Production build into dist/
npm run preview  # Preview the production build
```

## Environment

Define the following `VITE_` variables in a `.env` file (or use defaults from `env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MONITORING_API_URL` | `http://localhost:4400` | REST base URL for fallbacks/manual refresh |
| `VITE_MONITORING_WS_URL` | `ws://localhost:4400/ws/trades` | WebSocket endpoint |
| `VITE_MONITORING_MAX_TRADES` | `100` | Trade rows to retain client-side |

## Usage Tips

- Runs entirely client-side; the only requirement is reaching the monitoring API over HTTP/WebSocket.
- The dashboard gracefully degrades to REST polling if WebSockets are unavailable.
- Styling is intentionally lightweight – extend `src/styles.css` for a custom look.
