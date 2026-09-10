import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';
import { CONTRACT_ADDRESS, EXPLORER_BASE } from './config';
import type { Address, Agreement, Attempt, Determination, GuardConfig } from './types';

const readClient = createClient({ chain: studionet }) as any;

export const STUDIONET_CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

function makeWriteClient(account: Address) {
  if (!window.ethereum) throw new Error('A browser wallet was not detected.');
  return createClient({
    chain: studionet,
    account,
    provider: window.ethereum,
  }) as any;
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) throw new Error('Install or enable a browser wallet first.');
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('No wallet account was returned.');
  return accounts[0] as Address;
}

/**
 * Snap-free network selection.
 *
 * `client.connect('studionet')` in genlayer-js 1.1.8 calls `wallet_getSnaps`,
 * which non-Flask MetaMask rejects with "method doesn't have corresponding
 * handler". Switching the chain directly is the supported path for a plain
 * browser wallet.
 */
export async function ensureStudioNet(account: Address) {
  if (!window.ethereum) throw new Error('A browser wallet was not detected.');
  const client = makeWriteClient(account);
  const current = String(await window.ethereum.request({ method: 'eth_chainId' }));

  if (current.toLowerCase() !== STUDIONET_CHAIN_ID_HEX.toLowerCase()) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
      });
    } catch (error: any) {
      if (error?.code === 4001) throw new Error('Network switch was rejected in the wallet.');
      if (error?.code !== 4902) throw error;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: STUDIONET_CHAIN_ID_HEX,
            chainName: studionet.name,
            rpcUrls: studionet.rpcUrls.default.http,
            nativeCurrency: studionet.nativeCurrency,
            blockExplorerUrls: [studionet.blockExplorers?.default?.url].filter(Boolean),
          },
        ],
      });
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
      });
    }
  }

  return client;
}

/* ------------------------------------------------------------------ reads */

async function readJson<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    stateStatus: 'finalized',
  });
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

export const getConfig = () => readJson<GuardConfig>('get_config');
export const getAgreement = (agreementId: number) =>
  readJson<Agreement>('get_agreement', [agreementId]);
export const getAttempt = (agreementId: number, attemptId: number) =>
  readJson<Attempt>('get_attempt', [agreementId, attemptId]);
export const getAttempts = (agreementId: number, fromId: number, count: number) =>
  readJson<Attempt[]>('get_attempts', [agreementId, fromId, count]);
export const getDetermination = (determinationId: number) =>
  readJson<Determination>('get_determination', [determinationId]);

/* ----------------------------------------------------------------- writes */

async function write(
  account: Address,
  functionName: string,
  args: unknown[],
  value: bigint = 0n,
) {
  const client = await ensureStudioNet(account);
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
  }) as Promise<`0x${string}`>;
}

export const createAgreementTx = (
  account: Address,
  responsibleParty: string,
  dutyText: string,
  refundWindowSeconds: number,
  escrowWei: bigint,
) => write(account, 'create_agreement', [responsibleParty, dutyText, refundWindowSeconds], escrowWei);

export const acceptDutyTx = (account: Address, agreementId: number) =>
  write(account, 'accept_duty', [agreementId]);

export const proposeDeterminationTx = (
  account: Address,
  agreementId: number,
  candidateClause: string,
) => write(account, 'propose_determination', [agreementId, candidateClause]);

export const countersignDeterminationTx = (account: Address, agreementId: number) =>
  write(account, 'countersign_determination', [agreementId]);

export const releaseEscrowTx = (account: Address, agreementId: number) =>
  write(account, 'release_escrow', [agreementId]);

export const refundEscrowTx = (account: Address, agreementId: number) =>
  write(account, 'refund_escrow', [agreementId]);

/* --------------------------------------------------- execution inspection */

/**
 * StudioNet caveat, verified against genlayer-js 1.1.8:
 * `waitForTransactionReceipt` routes a chain with `isStudio` through
 * `decodeLocalnetTransaction`, which never sets `txExecutionResultName`.
 * Only `decodeTransaction` (used by `getTransaction`) sets it. So the receipt
 * alone can look identical for a successful and a reverted write, and this
 * module reads the leader receipt directly rather than trusting that field.
 */
function leaderReceipts(receipt: any): any[] {
  const sources = [receipt, receipt?._transaction, receipt?.transaction];
  for (const source of sources) {
    const list = source?.consensus_data?.leader_receipt;
    if (Array.isArray(list) && list.length) return list;
    if (list) return [list];
  }
  return [];
}

function executionName(value: any) {
  return String(
    value?.txExecutionResultName ||
      value?.executionResultName ||
      value?.transaction?.txExecutionResultName ||
      value?.transaction?.executionResultName ||
      '',
  ).toUpperCase();
}

export function executionOutcome(receipt: any) {
  const leaders = leaderReceipts(receipt);
  if (leaders.length) {
    const failed = leaders.some(
      (entry) => String(entry?.execution_result || '').toUpperCase() === 'ERROR',
    );
    if (failed) return { ok: false as const, name: 'FINISHED_WITH_ERROR' };
    const succeeded = leaders.some(
      (entry) => String(entry?.execution_result || '').toUpperCase() === 'SUCCESS',
    );
    if (succeeded) return { ok: true as const, name: 'FINISHED_WITH_RETURN' };
  }

  for (const source of [receipt, receipt?._transaction]) {
    const name = executionName(source);
    if (name === 'FINISHED_WITH_RETURN') return { ok: true as const, name };
    if (name === 'FINISHED_WITH_ERROR') return { ok: false as const, name };
  }
  return { ok: null, name: 'EXECUTION_RESULT_UNAVAILABLE' };
}

/**
 * The revert reason as the contract wrote it.
 *
 * `consensus_data.leader_receipt[].result` is `{status, payload}`. Only result
 * codes 1 (rollback) and 2 (contract_error) carry a UTF-8 message; every other
 * status carries validator bookkeeping that must never be shown as if the
 * contract had said it.
 */
function decodePayload(result: any): string {
  const status = Number(result?.status ?? result?.[0]);
  if (status !== 1 && status !== 2) return '';
  const payload = result?.payload ?? result?.[1];
  if (typeof payload === 'string') return payload.trim();
  if (Array.isArray(payload)) {
    try {
      return new TextDecoder().decode(Uint8Array.from(payload)).trim();
    } catch {
      return '';
    }
  }
  return '';
}

export function executionErrorDetail(receipt: unknown, fallback = 'Contract execution failed.') {
  for (const entry of leaderReceipts(receipt)) {
    const message = decodePayload(entry?.result);
    if (message) return message;
  }
  return fallback;
}

export async function waitFinalized(txHash: `0x${string}`) {
  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 240,
    fullTransaction: true,
  });

  if (executionOutcome(receipt).ok !== null) {
    console.debug('[AuthoritySplit] finalized receipt', txHash, receipt);
    return receipt;
  }

  try {
    const transaction = await readClient.getTransaction({ hash: txHash });
    const merged = { ...receipt, _transaction: transaction };
    console.debug('[AuthoritySplit] finalized receipt (+getTransaction)', txHash, merged);
    return merged;
  } catch {
    console.debug('[AuthoritySplit] finalized receipt (no transaction)', txHash, receipt);
    return receipt;
  }
}

/* ----------------------------------------------------------------- format */

export function txExplorerUrl(hash: string) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

const WEI_PER_GEN = 1_000_000_000_000_000_000n;

/** Decimal GEN string -> wei. Rejects anything that is not a plain amount. */
export function genToWei(input: string): bigint {
  const text = input.trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') {
    throw new Error('Enter the escrow amount as a plain number of GEN.');
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > 18) throw new Error('GEN amounts support at most 18 decimals.');
  const padded = (fraction + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole || '0') * WEI_PER_GEN + BigInt(padded || '0');
}

/** wei (decimal string) -> short GEN string. */
export function weiToGen(wei: string | bigint): string {
  let value: bigint;
  try {
    value = typeof wei === 'bigint' ? wei : BigInt(wei || '0');
  } catch {
    return '—';
  }
  const whole = value / WEI_PER_GEN;
  const fraction = (value % WEI_PER_GEN).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function cleanError(error: unknown) {
  const e = error as any;
  return String(e?.shortMessage || e?.message || e || 'Unknown error')
    .replace(/^Error:\s*/i, '')
    .replace(/\n\s*Details:[\s\S]*$/i, '')
    .trim();
}
