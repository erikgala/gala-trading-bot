import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfitSummary, SocketMessage, Trade } from './types';

const API_BASE_URL = (import.meta.env.VITE_MONITORING_API_URL as string | undefined) ?? 'http://localhost:4400';
const WEBSOCKET_URL = (import.meta.env.VITE_MONITORING_WS_URL as string | undefined) ?? 'ws://localhost:4400/ws/trades';
const MAX_TRADES = Number(import.meta.env.VITE_MONITORING_MAX_TRADES ?? 100);

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentageFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type ConnectionState = 'connecting' | 'online' | 'offline';

type TradesUpdater = (trade: Trade) => void;

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return currencyFormatter.format(value);
}

function formatPercentage(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return percentageFormatter.format(value / 100);
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return `${date.toLocaleDateString()} ${timeFormatter.format(date)}`;
}

function useWebSocket(
  onInitialTrades: (trades: Trade[]) => void,
  onTrade: TradesUpdater,
  onSummary: (summary: ProfitSummary) => void,
  onError: (error: string) => void,
) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const lastMessageRef = useRef<Date | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      try {
        socket = new WebSocket(WEBSOCKET_URL);
      } catch (error) {
        onError('Unable to open WebSocket connection');
        setState('offline');
        return;
      }

      setState('connecting');

      socket.addEventListener('open', () => {
        if (!mounted) return;
        setState('online');
      });

      socket.addEventListener('close', () => {
        if (!mounted) return;
        setState('offline');
        // Attempt reconnection after short delay
        setTimeout(connect, 2_500);
      });

      socket.addEventListener('error', event => {
        console.error('WebSocket error', event);
        onError('WebSocket connection error');
        setState('offline');
      });

      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data) as SocketMessage;
          lastMessageRef.current = new Date();

          if (message.type === 'init') {
            onInitialTrades(message.payload.trades);
            onSummary(message.payload.summary);
          } else if (message.type === 'trade') {
            onTrade(message.payload.trade);
            onSummary(message.payload.summary);
          } else if (message.type === 'summary') {
            onSummary(message.payload);
          } else if (message.type === 'error') {
            onError(message.payload);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message', error);
          onError('Received malformed data from server');
        }
      });
    };

    connect();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [onInitialTrades, onTrade, onSummary, onError]);

  return { state, lastMessageRef };
}

export default function App(): JSX.Element {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const replaceTrades = useCallback((incoming: Trade[]) => {
    setTrades(() => {
      const unique = new Map<string, Trade>();
      incoming.forEach(trade => unique.set(trade.executionId, trade));
      return Array.from(unique.values()).slice(0, MAX_TRADES);
    });
  }, []);

  const upsertTrade = useCallback<TradesUpdater>(trade => {
    setTrades(previous => {
      const filtered = previous.filter(t => t.executionId !== trade.executionId);
      return [trade, ...filtered].slice(0, MAX_TRADES);
    });
  }, []);

  const setSummarySafe = useCallback((incoming: ProfitSummary) => {
    setSummary(prev => {
      if (!prev) {
        return incoming;
      }

      return {
        ...incoming,
        lastUpdated: incoming.lastUpdated ?? prev.lastUpdated,
      };
    });
  }, []);

  const handleError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  const { state: connectionState } = useWebSocket(replaceTrades, upsertTrade, setSummarySafe, handleError);

  useEffect(() => {
    if (connectionState === 'online') {
      setErrorMessage(null);
    }
  }, [connectionState]);

  const fetchFromRest = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [tradesResponse, summaryResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/trades/recent?limit=${MAX_TRADES}`),
        fetch(`${API_BASE_URL}/api/summary`),
      ]);

      if (tradesResponse.ok) {
        const tradePayload = (await tradesResponse.json()) as Trade[];
        replaceTrades(tradePayload);
      } else {
        throw new Error('Failed to fetch recent trades');
      }

      if (summaryResponse.ok) {
        const summaryPayload = (await summaryResponse.json()) as ProfitSummary;
        setSummary(summaryPayload);
      }

      setErrorMessage(null);
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to refresh data from API');
    } finally {
      setIsRefreshing(false);
    }
  }, [replaceTrades]);

  useEffect(() => {
    fetchFromRest().catch(error => console.error('Initial data fetch failed', error));
  }, [fetchFromRest]);

  const totals = useMemo(() => {
    if (!summary) {
      return null;
    }

    const average = formatCurrency(summary.averageProfitPerTrade);
    return {
      totalProfit: formatCurrency(summary.totalProfit),
      realizedProfit: formatCurrency(summary.realizedProfit),
      unrealizedProfit: formatCurrency(summary.unrealizedProfit),
      averageProfitPerTrade: average,
      totalTrades: summary.totalTrades,
      profitableTrades: summary.profitableTrades,
      lastUpdated: formatDate(summary.lastUpdated),
    };
  }, [summary]);

  const statusLabel = useMemo(() => {
    if (connectionState === 'online') return 'Live connection';
    if (connectionState === 'connecting') return 'Connecting…';
    return 'Offline';
  }, [connectionState]);

  const connectionDotClass = useMemo(() => {
    return connectionState === 'online' ? 'connection-dot online' : 'connection-dot';
  }, [connectionState]);

  return (
    <div className="layout">
      <header className="header">
        <div>
          <h1>Gala Trading Bot Monitor</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Real-time trade executions and profit/loss streamed from the monitoring API.
          </p>
        </div>
        <div className="header-controls">
          <span className={connectionDotClass} aria-hidden="true" />
          <span className="connection-status">{statusLabel}</span>
          <button className="refresh-button" type="button" disabled={isRefreshing} onClick={fetchFromRest}>
            {isRefreshing ? 'Refreshing…' : 'Manual Refresh'}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="badge error" role="alert">
          {errorMessage}
        </div>
      )}

      {totals && (
        <section>
          <h2>Performance Overview</h2>
          <div className="summary-grid" aria-live="polite">
            <article className="summary-card">
              <h3>Total Profit</h3>
              <strong>{totals.totalProfit}</strong>
              <span>Combined realized + unrealized</span>
            </article>
            <article className="summary-card">
              <h3>Realized Profit</h3>
              <strong>{totals.realizedProfit}</strong>
              <span>Settled trade outcomes</span>
            </article>
            <article className="summary-card">
              <h3>Unrealized Profit</h3>
              <strong>{totals.unrealizedProfit}</strong>
              <span>Estimated vs. realized delta</span>
            </article>
            <article className="summary-card">
              <h3>Average Profit / Trade</h3>
              <strong>{totals.averageProfitPerTrade}</strong>
              <span>
                {totals.profitableTrades}/{totals.totalTrades} profitable trades
              </span>
            </article>
          </div>
        </section>
      )}

      <section className="trade-table-container">
        <h2>Recent Trades</h2>
        {trades.length === 0 ? (
          <div className="empty-state">No trades recorded yet. Data will appear here once the bot executes.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Execution</th>
                <th>Strategy</th>
                <th>Status</th>
                <th>Entry → Exit</th>
                <th>Profit</th>
                <th>P/L %</th>
                <th>Buy Amount</th>
                <th>Sell Output</th>
                <th>Started</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {trades.map(trade => {
                const profitClass = trade.profit.effective > 0 ? 'badge success' : trade.profit.effective < 0 ? 'badge error' : 'badge';
                const statusClass =
                  trade.status === 'completed' ? 'badge success' : trade.status === 'failed' ? 'badge error' : 'badge warning';

                return (
                  <tr key={trade.executionId}>
                    <td style={{ fontFamily: 'monospace' }}>{trade.executionId.slice(0, 8)}</td>
                    <td>{trade.strategy}</td>
                    <td>
                      <span className={statusClass}>{trade.status}</span>
                    </td>
                    <td>
                      {trade.entryToken.symbol} → {trade.exitToken.symbol}
                    </td>
                    <td>
                      <span className={profitClass}>{formatCurrency(trade.profit.effective)}</span>
                    </td>
                    <td>{formatPercentage(trade.profit.percentage)}</td>
                    <td>{formatCurrency(trade.amount.buyInput)}</td>
                    <td>{formatCurrency(trade.amount.sellOutput)}</td>
                    <td>{formatDate(trade.startTime)}</td>
                    <td>{formatDate(trade.endTime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
