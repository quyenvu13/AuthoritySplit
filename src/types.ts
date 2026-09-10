export type Address = `0x${string}`;

export type GuardConfig = {
  name: string;
  version: string;
  semantic_verdicts: string[];
  agreement_count: number;
  determination_count: number;
  max_text_length: number;
  max_determination_versions: number;
  max_attempts_per_agreement: number;
  max_semantic_evals_per_agreement: number;
  min_refund_window: number;
  max_refund_window: number;
  global_admin: string | null;
};

export type AgreementStatus =
  | 'AWAITING_ACCEPTANCE'
  | 'ACTIVE'
  | 'RELEASED'
  | 'REFUNDED';

export type Agreement = {
  agreement_id: number;
  obligee: Address;
  responsible_party: Address;
  duty_text: string;
  status: AgreementStatus | string;
  accepted: boolean;
  /** wei, as a decimal string — never a JS number */
  escrow_wei: string;
  refund_deadline_unix: number;
  active_determination_id: number;
  active_version: number;
  active_determination_text: string;
  active_proposed_by: string;
  active_countersigned_by: string;
  pending_clause_text: string;
  pending_proposed_by: string;
  version_count: number;
  attempt_count: number;
  semantic_eval_count: number;
  self_judging_blocks: number;
};

export type Attempt = {
  agreement_id?: number;
  attempt_id: number;
  proposer?: Address;
  candidate_clause?: string;
  verdict: 'INDEPENDENT_DETERMINATION' | 'SELF_JUDGING_AUTHORITY' | string;
  accepted: boolean;
  resulting_determination_id: number;
  used_cache: boolean;
};

export type Determination = {
  determination_id: number;
  agreement_id: number;
  version_number: number;
  text: string;
  verdict: string;
  proposed_by: Address;
  countersigned_by: Address;
  from_attempt: number;
};

export type TxPhase = 'IDLE' | 'SUBMITTED' | 'FINALIZED' | 'VERIFIED' | 'ERROR';

export type TxView = {
  phase: TxPhase;
  label: string;
  hash?: `0x${string}`;
  message?: string;
};

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      removeListener?(event: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
