export type Address = `0x${string}`;

export type GuardConfig = {
  name: string;
  version: string;
  semantic_verdicts: string[];
  clock_used: boolean;
  global_admin: boolean;
  max_determination_versions: number;
  max_attempts_per_workspace: number;
  max_semantic_evals_per_workspace: number;
  workspace_count: number;
  determination_count: number;
};

export type Workspace = {
  workspace_id: number;
  authority: Address;
  responsible_party_label: string;
  duty_text: string;
  active_determination_id: number;
  active_version: number;
  active_determination_text: string;
  version_count: number;
  attempt_count: number;
  semantic_eval_count: number;
  self_judging_blocks: number;
};

export type Attempt = {
  workspace_id?: number;
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
  workspace_id: number;
  version_number: number;
  text: string;
  verdict: string;
  from_attempt: number;
  is_active: boolean;
};

export type TxPhase = 'IDLE' | 'SUBMITTED' | 'FINALIZED' | 'VERIFIED' | 'ERROR';

export type TxView = {
  phase: TxPhase;
  label: string;
  hash?: `0x${string}`;
  message?: string;
  execution?: string;
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
