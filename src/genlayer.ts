import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types';
import { CONTRACT_ADDRESS, EXPLORER_BASE } from './config';
import type { Address, Attempt, Determination, GuardConfig, Workspace } from './types';

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

async function readFinal<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    stateStatus: 'finalized',
  }) as Promise<T>;
}

export const getConfig = () => readFinal<GuardConfig>('get_config');
export const getWorkspace = (workspaceId: number) =>
  readFinal<Workspace>('get_workspace', [workspaceId]);
export const getAttempt = (workspaceId: number, attemptId: number) =>
  readFinal<Attempt>('get_attempt', [workspaceId, attemptId]);
export const getAttempts = (workspaceId: number, fromId: number, count: number) =>
  readFinal<Attempt[]>('get_attempts', [workspaceId, fromId, count]);
export const getDetermination = (determinationId: number) =>
  readFinal<Determination>('get_determination', [determinationId]);

export async function createWorkspaceTx(
  account: Address,
  responsiblePartyLabel: string,
  dutyText: string,
) {
  const client = await ensureStudioNet(account);
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'create_workspace',
    args: [responsiblePartyLabel, dutyText],
    value: 0n,
  }) as Promise<`0x${string}`>;
}

export async function proposeDeterminationTx(
  account: Address,
  workspaceId: number,
  candidateClause: string,
) {
  const client = await ensureStudioNet(account);
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'propose_determination',
    args: [workspaceId, candidateClause],
    value: 0n,
  }) as Promise<`0x${string}`>;
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
  for (const source of [receipt, receipt?._transaction]) {
    const name = executionName(source);
    if (name === ExecutionResult.FINISHED_WITH_RETURN || name === 'FINISHED_WITH_RETURN') {
      return { ok: true as const, name: 'FINISHED_WITH_RETURN' };
    }
    if (name === ExecutionResult.FINISHED_WITH_ERROR || name === 'FINISHED_WITH_ERROR') {
      return { ok: false as const, name: 'FINISHED_WITH_ERROR' };
    }
  }
  return { ok: null, name: 'EXECUTION_RESULT_UNAVAILABLE' };
}

export async function waitFinalized(txHash: `0x${string}`) {
  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 240,
    fullTransaction: true,
  });

  if (executionOutcome(receipt).ok !== null) return receipt;

  try {
    const transaction = await readClient.getTransaction({ hash: txHash });
    return { ...receipt, _transaction: transaction };
  } catch {
    return receipt;
  }
}

function deepStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => deepStrings(item, output));
  else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => deepStrings(item, output));
  }
  return output;
}

export function executionErrorDetail(receipt: unknown, fallback = 'Contract execution failed.') {
  const strings = deepStrings(receipt)
    .map((value) => value.trim())
    .filter(Boolean);
  const preferred = strings.find((value) =>
    /only the workspace authority|semantic evaluation limit|attempt limit|version limit|matches active|invalid|cannot|too long|empty|error|rollback|usererror/i.test(
      value,
    ),
  );
  return preferred || fallback;
}

export function txExplorerUrl(hash: string) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function cleanError(error: unknown) {
  const e = error as any;
  return String(e?.shortMessage || e?.message || e || 'Unknown error')
    .replace(/^Error:\s*/i, '')
    .replace(/\n\s*Details:[\s\S]*$/i, '')
    .trim();
}
