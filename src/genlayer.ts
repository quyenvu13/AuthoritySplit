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
 * The revert reason, in the contract's own words.
 *
 * Field names inside a StudioNet receipt are not something this app should
 * guess: guessing wrong once already turned a successful `accept_duty` into a
 * reported refusal. So instead of trusting a path, this walks every string in
 * the receipt (decoding byte arrays on the way) and returns the first one that
 * is a sentence `contracts/AuthoritySplit.py` can actually raise. It cannot
 * invent a message, and it cannot mistake validator bookkeeping for one.
 *
 * A user could of course type one of these sentences into a clause, so this is
 * only ever consulted after a postcondition has already failed — never to
 * decide whether an action succeeded.
 */
const CONTRACT_ERRORS = [
  'Responsible party must differ from the obligee',
  'Only the named responsible party may accept the duty',
  'The proposing party cannot countersign its own clause',
  'No independent determination clause is in force',
  'An independent determination clause is already in force',
  'Candidate matches active determination clause',
  'Agreement semantic evaluation limit reached',
  'No determination clause is awaiting signature',
  'Only a party to this agreement may countersign',
  'Only a party to this agreement may propose',
  'Only the obligee may reclaim escrow',
  'Only the obligee may release escrow',
  'Agreement is not awaiting acceptance',
  'Determination version limit reached',
  'Agreement attempt limit reached',
  'Escrow must be greater than zero',
  'Refund window must be an integer',
  'Invalid semantic output schema',
  'Refund deadline has not passed',
  'Invalid semantic verdict type',
  'Agreement is already settled',
  'Semantic provider failure',
  'Refund window out of range',
  'Invalid semantic verdict',
  'Invalid semantic output',
  'Invalid chain datetime',
  'Invalid determination id',
  'Agreement is not active',
  'Invalid agreement id',
  'No escrow to reclaim',
  'Invalid attempt id',
  'No escrow to release',
  'Text cannot be empty',
  'Invalid address',
  'Text is too long',
];

function collectStrings(value: unknown, out: string[], depth = 0): string[] {
  if (depth > 8 || out.length > 4000) return out;
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    if (value.length && value.every((item) => typeof item === 'number')) {
      try {
        out.push(new TextDecoder().decode(Uint8Array.from(value as number[])));
      } catch {
        /* not a byte string */
      }
    }
    value.forEach((item) => collectStrings(item, out, depth + 1));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectStrings(item, out, depth + 1),
    );
  }
  return out;
}

export function executionErrorDetail(receipt: unknown, fallback = '') {
  const haystack = collectStrings(receipt, []);
  for (const text of haystack) {
    for (const known of CONTRACT_ERRORS) {
      if (text.includes(known)) return known;
    }
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

  // `waitForTransactionReceipt` routes a chain with `isStudio` through
  // `decodeLocalnetTransaction`, which populates fewer fields than
  // `decodeTransaction`. Fetching the transaction as well gives the revert
  // scanner more to work with. Both are logged so a reviewer can inspect the
  // exact shape rather than take this module's word for it.
  let merged: any = receipt;
  try {
    merged = { ...receipt, _transaction: await readClient.getTransaction({ hash: txHash }) };
  } catch {
    /* the receipt alone is enough */
  }
  console.log('[AuthoritySplit] finalized', txHash, merged);
  return merged;
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
