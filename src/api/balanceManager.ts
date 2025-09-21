import { stringifyTokenClassKey } from '@gala-chain/gswap-sdk';
import type { UserAssetsResponse } from './types';

export class BalanceSnapshot {
  private readonly balances: Map<string, number>;
  readonly fetchedAt: number;

  constructor(balances: Map<string, number>, fetchedAt: number) {
    this.balances = balances;
    this.fetchedAt = fetchedAt;
  }

  getBalance(tokenClass: string): number {
    return this.balances.get(tokenClass) ?? 0;
  }
}

export interface BalanceManagerOptions {
  isMockMode: boolean;
  balanceRefreshInterval: number;
  mockWalletBalances: Record<string, number>;
  fetchUserAssets: () => Promise<UserAssetsResponse>;
}

export class BalanceManager {
  private balanceSnapshot: BalanceSnapshot | null = null;
  private mockBalances: Map<string, number> | null = null;

  constructor(private readonly options: BalanceManagerOptions) {}

  async getSnapshot(forceRefresh: boolean = false): Promise<BalanceSnapshot> {
    if (!forceRefresh && this.balanceSnapshot && !this.isSnapshotExpired(this.balanceSnapshot)) {
      return this.balanceSnapshot;
    }

    try {
      const snapshot = this.options.isMockMode
        ? this.buildSnapshotFromMockBalances()
        : await this.buildBalanceSnapshot();

      this.balanceSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      console.error('Failed to refresh balance snapshot:', error);

      if (this.balanceSnapshot) {
        return this.balanceSnapshot;
      }

      const emptySnapshot = this.options.isMockMode
        ? this.buildSnapshotFromMockBalances()
        : new BalanceSnapshot(new Map(), Date.now());

      this.balanceSnapshot = emptySnapshot;
      return emptySnapshot;
    }
  }

  async refreshSnapshot(): Promise<BalanceSnapshot> {
    return this.getSnapshot(true);
  }

  async checkTradingFunds(requiredAmount: number, tokenClass: string, snapshot?: BalanceSnapshot): Promise<{
    hasFunds: boolean;
    currentBalance: number;
    shortfall: number;
  }> {
    try {
      const balanceSnapshot = snapshot ?? await this.getSnapshot();
      const currentBalance = balanceSnapshot.getBalance(tokenClass);
      const shortfall = Math.max(0, requiredAmount - currentBalance);

      return {
        hasFunds: currentBalance >= requiredAmount,
        currentBalance,
        shortfall,
      };
    } catch (error) {
      console.error(`Failed to check trading funds for ${tokenClass}:`, error);
      return {
        hasFunds: false,
        currentBalance: 0,
        shortfall: requiredAmount,
      };
    }
  }

  applyMockSwap(
    inputTokenClass: string,
    outputTokenClass: string,
    inputAmount: number,
    outputAmount: number
  ): void {
    if (!this.options.isMockMode) {
      return;
    }

    const balances = this.getMockBalances();
    const currentInput = balances.get(inputTokenClass) ?? 0;

    if (currentInput < inputAmount) {
      throw new Error(`Insufficient mock balance for ${inputTokenClass}`);
    }

    balances.set(inputTokenClass, currentInput - inputAmount);

    const currentOutput = balances.get(outputTokenClass) ?? 0;
    balances.set(outputTokenClass, currentOutput + outputAmount);

    this.balanceSnapshot = this.buildSnapshotFromMockBalances();
  }

  private async buildBalanceSnapshot(): Promise<BalanceSnapshot> {
    const userAssets = await this.options.fetchUserAssets();
    const balances = new Map<string, number>();

    const tokens = userAssets?.tokens ?? [];
    for (const token of tokens) {
      const tokenClass = stringifyTokenClassKey({
        collection: token.collection ?? token.symbol,
        category: token.category ?? 'Unit',
        type: token.type ?? 'none',
        additionalKey: token.additionalKey ?? 'none',
      });

      const quantity = parseFloat(token.quantity ?? '0');
      if (!Number.isNaN(quantity)) {
        balances.set(tokenClass, quantity);
      }
    }

    return new BalanceSnapshot(balances, Date.now());
  }

  private isSnapshotExpired(snapshot: BalanceSnapshot): boolean {
    if (this.options.balanceRefreshInterval === 0) {
      return false;
    }

    return Date.now() - snapshot.fetchedAt >= this.options.balanceRefreshInterval;
  }

  private getMockBalances(): Map<string, number> {
    if (!this.mockBalances) {
      this.initializeMockBalances();
    }

    return this.mockBalances!;
  }

  private initializeMockBalances(): void {
    this.mockBalances = new Map<string, number>();

    for (const [tokenClass, quantity] of Object.entries(this.options.mockWalletBalances)) {
      this.mockBalances.set(tokenClass, quantity);
    }
  }

  private buildSnapshotFromMockBalances(): BalanceSnapshot {
    const balances = new Map<string, number>();
    const mockBalances = this.getMockBalances();

    for (const [tokenClass, quantity] of mockBalances.entries()) {
      balances.set(tokenClass, quantity);
    }

    return new BalanceSnapshot(balances, Date.now());
  }
}
