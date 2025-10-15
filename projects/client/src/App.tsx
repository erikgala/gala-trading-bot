import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaginatedTradesResponse, ProfitSummary, SocketMessage, Trade } from './types';

const API_BASE_URL = (import.meta.env.VITE_MONITORING_API_URL as string | undefined) ?? 'http://localhost:4400';
const WEBSOCKET_URL = (import.meta.env.VITE_MONITORING_WS_URL as string | undefined) ?? 'ws://localhost:4400/ws/trades';
const DEFAULT_PAGE_SIZE = 10;

function toPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

const FALLBACK_PAGE_SIZE = toPositiveInteger(
  Number(import.meta.env.VITE_MONITORING_MAX_TRADES ?? DEFAULT_PAGE_SIZE),
  DEFAULT_PAGE_SIZE,
);
const PAGE_SIZE = toPositiveInteger(
  Number(import.meta.env.VITE_MONITORING_PAGE_SIZE ?? FALLBACK_PAGE_SIZE),
  FALLBACK_PAGE_SIZE,
);

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

interface PaginationState {
  page: number;
  totalTrades: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

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
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    totalTrades: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const activeTradeRequests = useRef(0);
  const currentPageRef = useRef(1);
  const initialTradesAppliedRef = useRef(false);

  const applyTradesResponse = useCallback((payload: PaginatedTradesResponse) => {
    setTrades(payload.trades);
    setPagination({
      page: payload.page,
      totalTrades: payload.totalTrades,
      totalPages: payload.totalPages,
      hasNextPage: payload.hasNextPage,
      hasPreviousPage: payload.hasPreviousPage,
    });
  }, []);

  const fetchTradesPage = useCallback(async (page: number): Promise<PaginatedTradesResponse> => {
    activeTradeRequests.current += 1;
    setIsLoadingTrades(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/trades?page=${page}&pageSize=${PAGE_SIZE}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trades');
      }

      return (await response.json()) as PaginatedTradesResponse;
    } finally {
      activeTradeRequests.current = Math.max(activeTradeRequests.current - 1, 0);
      if (activeTradeRequests.current === 0) {
        setIsLoadingTrades(false);
      }
    }
  }, []);

  const loadTradesPage = useCallback(
    async (page: number, errorLabel: string) => {
      try {
        const payload = await fetchTradesPage(page);
        applyTradesResponse(payload);
        setErrorMessage(null);
        return payload;
      } catch (error) {
        console.error(error);
        setErrorMessage(errorLabel);
        throw error;
      }
    },
    [applyTradesResponse, fetchTradesPage],
  );

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

  const fetchSummary = useCallback(async (): Promise<ProfitSummary> => {
    const response = await fetch(`${API_BASE_URL}/api/summary`);
    if (!response.ok) {
      throw new Error('Failed to fetch summary');
    }

    return (await response.json()) as ProfitSummary;
  }, []);

  const fetchFromRest = useCallback(
    async (page: number) => {
      try {
        setIsRefreshing(true);
        const [_, summaryPayload] = await Promise.all([
          loadTradesPage(page, 'Unable to refresh trades from API'),
          fetchSummary(),
        ]);
        setSummary(summaryPayload);
        setErrorMessage(null);
      } catch (error) {
        console.error(error);
        setErrorMessage('Unable to refresh data from API');
      } finally {
        setIsRefreshing(false);
      }
    },
    [fetchSummary, loadTradesPage],
  );

  const handleInitialTrades = useCallback((incoming: Trade[]) => {
    if (initialTradesAppliedRef.current || incoming.length === 0) {
      return;
    }

    initialTradesAppliedRef.current = true;
    setTrades(incoming.slice(0, PAGE_SIZE));
    setPagination({
      page: 1,
      totalTrades: incoming.length,
      totalPages: incoming.length > 0 ? Math.ceil(incoming.length / PAGE_SIZE) : 0,
      hasNextPage: incoming.length > PAGE_SIZE,
      hasPreviousPage: false,
    });
  }, []);

  const handleTradeUpdate = useCallback<TradesUpdater>(
    () => {
      const pageToRefresh = currentPageRef.current;
      void loadTradesPage(pageToRefresh, 'Unable to refresh trades after update').catch(() => undefined);
    },
    [loadTradesPage],
  );

  const { state: connectionState } = useWebSocket(handleInitialTrades, handleTradeUpdate, setSummarySafe, handleError);
  useEffect(() => {
    currentPageRef.current = pagination.page;
  }, [pagination.page]);

  useEffect(() => {
    if (connectionState === 'online') {
      setErrorMessage(null);
    }
  }, [connectionState]);

  useEffect(() => {
    void fetchFromRest(1);
  }, [fetchFromRest]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      void loadTradesPage(nextPage, 'Unable to load trades for the selected page').catch(() => undefined);
    },
    [loadTradesPage],
  );

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

  const paginationSummary = useMemo(() => {
    if (pagination.totalTrades === 0 || trades.length === 0) {
      return { start: 0, end: 0 };
    }

    const start = (pagination.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + trades.length - 1, pagination.totalTrades);
    return { start, end };
  }, [pagination.page, pagination.totalTrades, trades.length]);

  const totalPagesDisplay = Math.max(1, pagination.totalPages || (pagination.totalTrades > 0 ? 1 : 0));

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
          <button
            className="refresh-button"
            type="button"
            disabled={isRefreshing}
            onClick={() => {
              void fetchFromRest(pagination.page);
            }}
          >
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
          <div className="empty-state">
            {isLoadingTrades ? 'Loading trades…' : 'No trades recorded yet. Data will appear here once the bot executes.'}
          </div>
        ) : (
          <>
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
                  const profitClass =
                    trade.profit.effective > 0 ? 'badge success' : trade.profit.effective < 0 ? 'badge error' : 'badge';
                  const statusClass =
                    trade.status === 'completed'
                      ? 'badge success'
                      : trade.status === 'failed'
                        ? 'badge error'
                        : 'badge warning';

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

            {pagination.totalTrades > 0 && (
              <div className="table-footer">
                <span>
                  Showing {paginationSummary.start}-{paginationSummary.end} of {pagination.totalTrades}
                </span>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="pagination-button"
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.hasPreviousPage || isLoadingTrades}
                  >
                    Previous
                  </button>
                  <span>
                    Page {pagination.page} of {totalPagesDisplay}
                  </span>
                  <button
                    type="button"
                    className="pagination-button"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasNextPage || isLoadingTrades}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
