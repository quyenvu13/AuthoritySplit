import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONTRACT_ADDRESS,
  CONTRACT_EXPLORER_URL,
  EXPECTED_CONTRACT_VERSION,
  RUNTIME_EVIDENCE_ADDRESS,
  RUNTIME_EXPLORER_URL,
  SOURCE_SHA256,
} from './config';
import {
  cleanError,
  connectWallet,
  createWorkspaceTx,
  executionErrorDetail,
  executionOutcome,
  getAttempt,
  getAttempts,
  getConfig,
  getDetermination,
  getWorkspace,
  proposeDeterminationTx,
  txExplorerUrl,
  waitFinalized,
} from './genlayer';
import type { Address, Attempt, Determination, GuardConfig, TxView, Workspace } from './types';

type Page = 'overview' | 'create' | 'workspace' | 'propose' | 'audit' | 'verification';

const PAGES: Array<{ id: Page; label: string; kicker: string }> = [
  { id: 'overview', label: 'Overview', kicker: 'Protocol' },
  { id: 'create', label: 'Create workspace', kicker: 'Authority' },
  { id: 'workspace', label: 'Workspace', kicker: 'State' },
  { id: 'propose', label: 'Propose clause', kicker: 'Decision' },
  { id: 'audit', label: 'Attempt log', kicker: 'Audit' },
  { id: 'verification', label: 'Verification', kicker: 'Proof' },
];

function short(value?: string, left = 6, right = 4) {
  if (!value) return '—';
  return value.length <= left + right + 3 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function copyText(value: string) {
  return navigator.clipboard?.writeText(value).catch(() => undefined);
}

function routeFromHash(): Page {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES.some((page) => page.id === raw) ? (raw as Page) : 'overview';
}

function setRoute(page: Page) {
  window.location.hash = `#/${page}`;
}

function verdictLabel(value?: string) {
  if (value === 'INDEPENDENT_DETERMINATION') return 'Independent determination';
  if (value === 'SELF_JUDGING_AUTHORITY') return 'Self-judging authority';
  return value || 'No verdict';
}

function verdictClass(value?: string) {
  if (value === 'INDEPENDENT_DETERMINATION') return 'verdict good';
  if (value === 'SELF_JUDGING_AUTHORITY') return 'verdict blocked';
  return 'verdict neutral';
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="section-head">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function AddressChip({ value, href }: { value: string; href?: string }) {
  const content = (
    <>
      <span className="chain-dot" />
      <span>{short(value, 8, 6)}</span>
      <button
        className="copy-mini"
        type="button"
        title="Copy address"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void copyText(value);
        }}
      >
        copy
      </button>
    </>
  );

  return href ? (
    <a className="address-chip" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <span className="address-chip">{content}</span>
  );
}

function TxBanner({ tx }: { tx: TxView | null }) {
  if (!tx || tx.phase === 'IDLE') return null;
  return (
    <div className={`tx-banner ${tx.phase.toLowerCase()}`}>
      <div className="tx-pulse" />
      <div>
        <span>{tx.label}</span>
        <strong>{tx.message || tx.phase}</strong>
        {tx.execution && <small>Execution: {tx.execution}</small>}
      </div>
      {tx.hash && (
        <a href={txExplorerUrl(tx.hash)} target="_blank" rel="noreferrer">
          {short(tx.hash, 10, 8)} ↗
        </a>
      )}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(() => routeFromHash());
  const [config, setConfig] = useState<GuardConfig | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [workspaceIdInput, setWorkspaceIdInput] = useState('');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [activeDetermination, setActiveDetermination] = useState<Determination | null>(null);
  const [latestAttempt, setLatestAttempt] = useState<Attempt | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [dutyInput, setDutyInput] = useState('');
  const [candidateInput, setCandidateInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tx, setTx] = useState<TxView | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const next = await getConfig();
      setConfig(next);
      return next;
    } catch (error) {
      setNotice(`Live config read failed: ${cleanError(error)}`);
      return null;
    }
  }, []);

  const loadWorkspace = useCallback(async (id: number, quiet = false) => {
    if (!Number.isInteger(id) || id <= 0) {
      if (!quiet) setNotice('Enter a workspace ID greater than zero.');
      return null;
    }

    try {
      const next = await getWorkspace(id);
      setWorkspace(next);
      setWorkspaceIdInput(String(id));

      if (next.active_determination_id > 0) {
        try {
          setActiveDetermination(await getDetermination(next.active_determination_id));
        } catch {
          setActiveDetermination(null);
        }
      } else {
        setActiveDetermination(null);
      }

      if (next.attempt_count > 0) {
        const count = Math.min(next.attempt_count, 20);
        const from = Math.max(1, next.attempt_count - count + 1);
        try {
          const rows = await getAttempts(id, from, count);
          setAttempts(rows);
          try {
            setLatestAttempt(await getAttempt(id, next.attempt_count));
          } catch {
            setLatestAttempt(rows[rows.length - 1] || null);
          }
        } catch {
          setAttempts([]);
          setLatestAttempt(null);
        }
      } else {
        setAttempts([]);
        setLatestAttempt(null);
      }

      if (!quiet) setNotice(`Loaded Workspace #${id} from finalized state.`);
      return next;
    } catch (error) {
      setWorkspace(null);
      setAttempts([]);
      setActiveDetermination(null);
      setLatestAttempt(null);
      if (!quiet) setNotice(cleanError(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    if (window.ethereum) {
      window.ethereum
        .request({ method: 'eth_accounts' })
        .then((value) => {
          const accounts = value as string[];
          if (accounts?.[0]) setAccount(accounts[0] as Address);
        })
        .catch(() => undefined);
    }
  }, [loadConfig]);

  useEffect(() => {
    const onHash = () => setPage(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const list = args[0] as string[] | undefined;
      setAccount((list?.[0] as Address | undefined) ?? null);
    };
    const onChain = () => setNotice('Network changed. The next write will require StudioNet.');
    window.ethereum.on('accountsChanged', onAccounts);
    window.ethereum.on('chainChanged', onChain);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts);
      window.ethereum?.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const sourceParityOk = Boolean(
    config &&
      config.name === 'SelfJudgingGuard' &&
      config.version === EXPECTED_CONTRACT_VERSION &&
      config.max_semantic_evals_per_workspace === 8,
  );

  const isAuthority = sameAddress(account, workspace?.authority);
  const semanticBudgetRemaining = workspace && config
    ? Math.max(0, config.max_semantic_evals_per_workspace - workspace.semantic_eval_count)
    : 0;

  const go = (next: Page) => {
    setRoute(next);
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function connect() {
    try {
      const next = await connectWallet();
      setAccount(next);
      setNotice(`Wallet connected: ${short(next, 8, 6)}.`);
    } catch (error) {
      setNotice(cleanError(error));
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!account) return setNotice('Connect the workspace authority wallet first.');
    const label = labelInput.trim();
    const duty = dutyInput.trim();
    if (!label || !duty) return setNotice('Responsible party and duty are both required.');

    setBusy(true);
    setTx({ phase: 'SUBMITTED', label: 'Create workspace', message: 'Preparing transaction…' });
    try {
      const before = await getConfig();
      const hash = await createWorkspaceTx(account, label, duty);
      setTx({ phase: 'SUBMITTED', label: 'Create workspace', hash, message: 'Submitted. Waiting for finalization…' });
      const receipt = await waitFinalized(hash);
      const outcome = executionOutcome(receipt);
      if (outcome.ok !== true) {
        throw new Error(executionErrorDetail(receipt, `Execution not proven successful: ${outcome.name}`));
      }
      setTx({ phase: 'FINALIZED', label: 'Create workspace', hash, execution: outcome.name, message: 'Finalized. Verifying contract state…' });

      const after = await getConfig();
      if (after.workspace_count !== before.workspace_count + 1) {
        throw new Error('Finalized create did not increase workspace_count by exactly one.');
      }
      const created = await getWorkspace(after.workspace_count);
      if (!sameAddress(created.authority, account) || created.responsible_party_label !== label || created.duty_text !== duty) {
        throw new Error('Finalized workspace state does not match the submitted authority, label, and duty.');
      }

      setConfig(after);
      setWorkspace(created);
      setWorkspaceIdInput(String(created.workspace_id));
      setAttempts([]);
      setLatestAttempt(null);
      setActiveDetermination(null);
      setLabelInput('');
      setDutyInput('');
      setTx({ phase: 'VERIFIED', label: 'Create workspace', hash, execution: outcome.name, message: `Workspace #${created.workspace_id} verified in finalized state.` });
      setNotice(`Workspace #${created.workspace_id} created and verified.`);
      go('workspace');
    } catch (error) {
      setTx((current) => ({
        phase: 'ERROR',
        label: 'Create workspace',
        hash: current?.hash,
        message: cleanError(error),
      }));
      setNotice(cleanError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePropose(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!account) return setNotice('Connect the workspace authority wallet first.');
    if (!workspace) return setNotice('Load a workspace first.');
    if (!isAuthority) return setNotice('The connected wallet is not this workspace authority.');
    const candidate = candidateInput.trim();
    if (!candidate) return setNotice('Enter a proposed determination clause.');

    setBusy(true);
    setTx({ phase: 'SUBMITTED', label: 'Propose determination', message: 'Preparing transaction…' });
    try {
      const before = await getWorkspace(workspace.workspace_id);
      const hash = await proposeDeterminationTx(account, workspace.workspace_id, candidate);
      setTx({ phase: 'SUBMITTED', label: 'Propose determination', hash, message: 'Submitted. Waiting for finalization…' });
      const receipt = await waitFinalized(hash);
      const outcome = executionOutcome(receipt);
      if (outcome.ok !== true) {
        throw new Error(executionErrorDetail(receipt, `Execution not proven successful: ${outcome.name}`));
      }
      setTx({ phase: 'FINALIZED', label: 'Propose determination', hash, execution: outcome.name, message: 'Finalized. Verifying consequence…' });

      const after = await getWorkspace(workspace.workspace_id);
      if (after.attempt_count !== before.attempt_count + 1) {
        throw new Error('Finalized proposal did not create exactly one attempt.');
      }
      const attempt = await getAttempt(workspace.workspace_id, after.attempt_count);

      if (attempt.verdict === 'INDEPENDENT_DETERMINATION') {
        if (!attempt.accepted || attempt.resulting_determination_id <= 0 || after.active_determination_id !== attempt.resulting_determination_id) {
          throw new Error('Independent verdict did not produce the required active determination state.');
        }
      } else if (attempt.verdict === 'SELF_JUDGING_AUTHORITY') {
        if (attempt.accepted || attempt.resulting_determination_id !== 0 || after.self_judging_blocks !== before.self_judging_blocks + 1) {
          throw new Error('Self-judging verdict did not produce the required blocked state.');
        }
      } else {
        throw new Error(`Unexpected stored verdict: ${attempt.verdict}`);
      }

      setCandidateInput('');
      setWorkspace(after);
      setLatestAttempt(attempt);
      await loadWorkspace(after.workspace_id, true);
      await loadConfig();
      setTx({
        phase: 'VERIFIED',
        label: 'Propose determination',
        hash,
        execution: outcome.name,
        message: `${verdictLabel(attempt.verdict)} verified in finalized state.`,
      });
      setNotice(`${verdictLabel(attempt.verdict)} · cache ${attempt.used_cache ? 'hit' : 'miss'}.`);
    } catch (error) {
      setTx((current) => ({
        phase: 'ERROR',
        label: 'Propose determination',
        hash: current?.hash,
        message: cleanError(error),
      }));
      setNotice(cleanError(error));
    } finally {
      setBusy(false);
    }
  }

  const workspaceTitle = workspace ? `Workspace #${workspace.workspace_id}` : 'No workspace loaded';

  return (
    <div className="app-shell">
      <aside className="rail">
        <button className="brand" type="button" onClick={() => go('overview')}>
          <img className="brand-logo" src="/logo.svg" alt="" aria-hidden="true" />
          <span>
            <strong>AuthoritySplit</strong>
            <small>Separate authority</small>
          </span>
        </button>

        <nav className="rail-nav">
          {PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? 'active' : ''}
              onClick={() => go(item.id)}
            >
              <span>{item.kicker}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div className="rail-bottom">
          <span className={`parity ${sourceParityOk ? 'ok' : 'warn'}`}>
            <i /> {sourceParityOk ? 'Live source profile matched' : 'Checking live contract'}
          </span>
          <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">StudioNet explorer ↗</a>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-contract">
            <span>PROJECT CONTRACT</span>
            <AddressChip value={CONTRACT_ADDRESS} href={CONTRACT_EXPLORER_URL} />
          </div>
          <div className="topbar-actions">
            {workspace && (
              <button className="workspace-pill" type="button" onClick={() => go('workspace')}>
                <span>OPEN</span> Workspace #{workspace.workspace_id}
              </button>
            )}
            <button className="wallet-button" type="button" onClick={connect} disabled={busy}>
              {account ? <><span className="wallet-led" />{short(account, 7, 5)}</> : 'Connect wallet'}
            </button>
          </div>
        </header>

        <TxBanner tx={tx} />
        {notice && <div className="notice-bar"><span>STATUS</span>{notice}</div>}

        <div className="page-wrap">
          {page === 'overview' && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-kicker">ON-CHAIN META-RIGHT GUARD</span>
                  <h1>No one should grade <em>their own</em> compliance.</h1>
                  <p>
                    AuthoritySplit separates the party that owes a duty from the authority that decides whether that duty was satisfied. The frozen SelfJudgingGuard contract asks one narrow semantic question; contract code applies the consequence.
                  </p>
                  <div className="hero-actions">
                    <button type="button" className="primary" onClick={() => go('create')}>Create workspace <span>→</span></button>
                    <button type="button" className="secondary" onClick={() => go('workspace')}>Inspect state</button>
                  </div>
                </div>
                <div className="authority-diagram" aria-label="Authority separation diagram">
                  <div className="diagram-top">
                    <span>RESPONSIBLE PARTY</span>
                    <strong>Duty holder</strong>
                  </div>
                  <div className="diagram-axis"><i /><b>FINAL DETERMINATION</b><i /></div>
                  <div className="diagram-choices">
                    <div className="choice blocked"><span>BLOCKED</span><strong>Unilateral control</strong><small>SELF_JUDGING_AUTHORITY</small></div>
                    <div className="choice good"><span>ACCEPTED</span><strong>Independent authority</strong><small>INDEPENDENT_DETERMINATION</small></div>
                  </div>
                </div>
              </section>

              <section className="stats-band">
                <Metric label="Workspaces" value={config?.workspace_count ?? '—'} note="finalized state" />
                <Metric label="Determinations" value={config?.determination_count ?? '—'} note="accepted versions" />
                <Metric label="Semantic budget" value={config ? `${config.max_semantic_evals_per_workspace} / workspace` : '—'} note="fresh classifications" />
                <Metric label="Contract version" value={config?.version ?? '—'} note={sourceParityOk ? 'expected profile' : 'verify live'} />
              </section>

              <section className="overview-grid">
                <article className="panel rule-panel">
                  <SectionHead eyebrow="THE RULE" title="Semantic scope stays narrow." />
                  <div className="rule-lines">
                    <div><span>01</span><p>Record an immutable duty and the party responsible for it.</p></div>
                    <div><span>02</span><p>Classify only who controls the final compliance determination.</p></div>
                    <div><span>03</span><p>Block self-judging authority; version independent determinations.</p></div>
                  </div>
                </article>
                <article className="panel boundary-panel">
                  <SectionHead eyebrow="NOT AN ORACLE" title="What the contract does not decide." />
                  <div className="boundary-tags">
                    <span>Whether performance actually occurred</span>
                    <span>Whether a duty is fair</span>
                    <span>Damages or remedies</span>
                    <span>External facts not in the clause</span>
                  </div>
                </article>
              </section>
            </>
          )}

          {page === 'create' && (
            <section className="two-col-page">
              <div>
                <SectionHead
                  eyebrow="CREATE WORKSPACE"
                  title="Freeze the duty before testing the decision authority."
                  body="The caller becomes the immutable workspace authority. Forms intentionally start empty; the app never preloads runtime evidence into a transaction form."
                />
                <div className="guard-note">
                  <span>IMMUTABLE CONTEXT</span>
                  <p>The responsible-party label and duty become the semantic context for every later determination proposal in this workspace.</p>
                </div>
              </div>
              <form className="panel form-panel" onSubmit={handleCreate}>
                <label>
                  <span>Responsible party label</span>
                  <input
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="e.g. Service Provider"
                    maxLength={200}
                    disabled={busy}
                  />
                  <small>{labelInput.length} / 200</small>
                </label>
                <label>
                  <span>Immutable duty</span>
                  <textarea
                    value={dutyInput}
                    onChange={(e) => setDutyInput(e.target.value)}
                    placeholder="Describe the duty whose compliance determination must remain independent."
                    maxLength={4000}
                    rows={9}
                    disabled={busy}
                  />
                  <small>{dutyInput.length} / 4000</small>
                </label>
                <div className="form-footer">
                  <div><span>Authority wallet</span><strong>{account ? short(account, 9, 7) : 'Connect wallet first'}</strong></div>
                  <button className="primary" type="submit" disabled={busy || !account}>Create workspace →</button>
                </div>
              </form>
            </section>
          )}

          {page === 'workspace' && (
            <>
              <section className="workspace-hero">
                <div>
                  <SectionHead eyebrow="FINALIZED STATE" title={workspaceTitle} body="Open any workspace ID. Reads are requested from finalized contract state." />
                </div>
                <form
                  className="workspace-loader"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadWorkspace(Number(workspaceIdInput));
                  }}
                >
                  <input
                    inputMode="numeric"
                    value={workspaceIdInput}
                    onChange={(e) => setWorkspaceIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Workspace ID"
                  />
                  <button type="submit" className="secondary">Open</button>
                </form>
              </section>

              {workspace ? (
                <>
                  <section className="workspace-grid">
                    <article className="panel duty-card">
                      <div className="card-meta"><span>DUTY HOLDER</span><AddressChip value={workspace.authority} /></div>
                      <h3>{workspace.responsible_party_label}</h3>
                      <blockquote>{workspace.duty_text}</blockquote>
                      <div className="authority-line">
                        <span>Workspace authority</span>
                        <strong>{sameAddress(account, workspace.authority) ? 'Connected wallet · authority' : short(workspace.authority, 9, 7)}</strong>
                      </div>
                    </article>

                    <article className="panel determination-card">
                      <div className="card-meta"><span>ACTIVE DETERMINATION</span><b>v{workspace.active_version}</b></div>
                      {workspace.active_determination_id > 0 ? (
                        <>
                          <span className="verdict good">INDEPENDENT</span>
                          <h3>Determination #{workspace.active_determination_id}</h3>
                          <blockquote>{workspace.active_determination_text}</blockquote>
                          {activeDetermination && <small>Accepted from attempt #{activeDetermination.from_attempt}</small>}
                        </>
                      ) : (
                        <div className="empty-card"><span>∅</span><strong>No active determination</strong><p>An independent clause has not been accepted yet.</p></div>
                      )}
                    </article>
                  </section>

                  <section className="counter-grid">
                    <Metric label="Attempts" value={workspace.attempt_count} note={`cap ${config?.max_attempts_per_workspace ?? 100}`} />
                    <Metric label="Fresh semantic evals" value={workspace.semantic_eval_count} note={`${semanticBudgetRemaining} remaining`} />
                    <Metric label="Blocked self-judging" value={workspace.self_judging_blocks} note="deterministic consequence" />
                    <Metric label="Accepted versions" value={workspace.version_count} note={`cap ${config?.max_determination_versions ?? 20}`} />
                  </section>

                  <section className="workspace-actions">
                    <button type="button" className="primary" onClick={() => go('propose')}>Propose determination →</button>
                    <button type="button" className="secondary" onClick={() => go('audit')}>Open attempt log</button>
                  </section>
                </>
              ) : (
                <div className="empty-state-large"><span>WORKSPACE</span><h3>Open a finalized workspace to inspect its authority boundary.</h3><p>No local browser state is used as evidence.</p></div>
              )}
            </>
          )}

          {page === 'propose' && (
            <section className="two-col-page propose-page">
              <div>
                <SectionHead eyebrow="PROPOSE DETERMINATION" title="Who controls the final answer?" body="The semantic call does not decide whether the duty was actually met. It only classifies unilateral decisive control over the final compliance determination." />
                {workspace ? (
                  <div className="context-card">
                    <div><span>Workspace</span><strong>#{workspace.workspace_id}</strong></div>
                    <div><span>Responsible party</span><strong>{workspace.responsible_party_label}</strong></div>
                    <div><span>Fresh semantic budget</span><strong>{semanticBudgetRemaining} remaining</strong></div>
                    <div><span>Connected role</span><strong className={isAuthority ? 'role-ok' : 'role-bad'}>{isAuthority ? 'Workspace authority' : 'Read only'}</strong></div>
                  </div>
                ) : (
                  <button className="secondary wide" type="button" onClick={() => go('workspace')}>Load a workspace first</button>
                )}
                <div className="semantic-boundary">
                  <span>SEMANTIC QUESTION</span>
                  <p>Can the responsible party, acting alone, determine, prevent, veto, override, appoint, replace, or otherwise control the final compliance outcome?</p>
                </div>
              </div>

              <form className="panel form-panel proposal-form" onSubmit={handlePropose}>
                <label>
                  <span>Workspace ID</span>
                  <input value={workspace?.workspace_id ?? ''} readOnly placeholder="Load a workspace" />
                </label>
                <label>
                  <span>Candidate determination clause</span>
                  <textarea
                    value={candidateInput}
                    onChange={(e) => setCandidateInput(e.target.value)}
                    placeholder="Write the proposed final determination authority."
                    maxLength={4000}
                    rows={11}
                    disabled={busy || !workspace}
                  />
                  <small>{candidateInput.length} / 4000</small>
                </label>
                <div className="form-footer stacked-mobile">
                  <div><span>Write permission</span><strong>{workspace ? (isAuthority ? 'Authorized' : 'Authority wallet required') : 'Load workspace'}</strong></div>
                  <button className="primary" type="submit" disabled={busy || !workspace || !account || !isAuthority}>Run determination →</button>
                </div>
              </form>

              {latestAttempt && (
                <article className="latest-result panel">
                  <span className="eyebrow">LATEST STORED ATTEMPT</span>
                  <div className="latest-heading">
                    <span className={verdictClass(latestAttempt.verdict)}>{verdictLabel(latestAttempt.verdict)}</span>
                    <strong>Attempt #{latestAttempt.attempt_id}</strong>
                  </div>
                  <div className="result-grid">
                    <div><span>Consequence</span><strong>{latestAttempt.accepted ? 'Accepted + versioned' : 'Blocked'}</strong></div>
                    <div><span>Semantic source</span><strong>{latestAttempt.used_cache ? 'Cache hit' : 'Fresh consensus'}</strong></div>
                    <div><span>Determination ID</span><strong>{latestAttempt.resulting_determination_id || '—'}</strong></div>
                  </div>
                </article>
              )}
            </section>
          )}

          {page === 'audit' && (
            <>
              <section className="workspace-hero">
                <div><SectionHead eyebrow="ATTEMPT LOG" title={workspace ? `Workspace #${workspace.workspace_id} audit trail` : 'Load a workspace'} body="The log shows stored consequential verdicts and whether the semantic cache was reused." /></div>
                {!workspace && <button type="button" className="secondary" onClick={() => go('workspace')}>Open workspace</button>}
              </section>

              {workspace && (
                <section className="audit-layout">
                  <div className="audit-summary panel">
                    <Metric label="Attempts" value={workspace.attempt_count} />
                    <Metric label="Fresh evals" value={workspace.semantic_eval_count} />
                    <Metric label="Cache reuses" value={Math.max(0, workspace.attempt_count - workspace.semantic_eval_count)} />
                    <Metric label="Blocked" value={workspace.self_judging_blocks} />
                  </div>
                  <div className="attempt-table panel">
                    <div className="table-head"><span>ID</span><span>Verdict</span><span>Consequence</span><span>Semantic</span></div>
                    {attempts.length ? attempts.map((attempt) => (
                      <div className="table-row" key={attempt.attempt_id}>
                        <strong>#{attempt.attempt_id}</strong>
                        <span className={verdictClass(attempt.verdict)}>{attempt.verdict === 'INDEPENDENT_DETERMINATION' ? 'INDEPENDENT' : 'SELF-JUDGING'}</span>
                        <span>{attempt.accepted ? `Determination #${attempt.resulting_determination_id}` : 'Blocked'}</span>
                        <span className={attempt.used_cache ? 'cache-hit' : 'cache-fresh'}>{attempt.used_cache ? 'CACHE HIT' : 'FRESH'}</span>
                      </div>
                    )) : <div className="table-empty">No attempts recorded in this workspace.</div>}
                  </div>
                </section>
              )}
            </>
          )}

          {page === 'verification' && (
            <>
              <section className="verification-hero">
                <SectionHead eyebrow="VERIFICATION" title="Frozen contract. Separate runtime evidence. Clean project address." body="The project contract is a fresh deployment of the frozen source. Runtime evidence was produced on a separate address so application state can start clean." />
              </section>

              <section className="verification-grid">
                <article className="panel verify-card">
                  <span>PROJECT ADDRESS</span>
                  <h3>{short(CONTRACT_ADDRESS, 12, 10)}</h3>
                  <p>Frontend target. Intended to remain clean until project users create workspaces.</p>
                  <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">Open project contract ↗</a>
                </article>
                <article className="panel verify-card">
                  <span>RUNTIME EVIDENCE</span>
                  <h3>{short(RUNTIME_EVIDENCE_ADDRESS, 12, 10)}</h3>
                  <p>Separate StudioNet deployment used for the load-bearing runtime checks.</p>
                  <a href={RUNTIME_EXPLORER_URL} target="_blank" rel="noreferrer">Open runtime contract ↗</a>
                </article>
              </section>

              <section className="panel source-card">
                <div>
                  <span className="eyebrow">FROZEN SOURCE SHA256</span>
                  <code>{SOURCE_SHA256}</code>
                </div>
                <button type="button" className="secondary" onClick={() => void copyText(SOURCE_SHA256)}>Copy hash</button>
              </section>

              <section className="proof-list">
                <div><span>01</span><strong>Self-judging consequence</strong><p>Semantic verdict stored as SELF_JUDGING_AUTHORITY; contract blocked the proposal and created no determination.</p><b>PASS</b></div>
                <div><span>02</span><strong>Independent consequence</strong><p>INDEPENDENT_DETERMINATION created and activated a new determination version.</p><b>PASS</b></div>
                <div><span>03</span><strong>Same-workspace reroll prevention</strong><p>Retry reused the cached verdict and did not consume an additional semantic evaluation.</p><b>PASS</b></div>
                <div><span>04</span><strong>Cross-workspace isolation</strong><p>The same clause in another workspace performed a fresh classification instead of inheriting another workspace's cache.</p><b>PASS</b></div>
                <div><span>05</span><strong>Authority boundary</strong><p>A non-authority proposal produced contract rollback and left finalized workspace state unchanged.</p><b>PASS</b></div>
              </section>
            </>
          )}
        </div>

        <footer>
          <div><img className="brand-logo small" src="/logo.svg" alt="" aria-hidden="true" /><strong>AuthoritySplit</strong></div>
          <p>Semantic classification is narrow. Consequences are deterministic.</p>
          <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">StudioNet ↗</a>
        </footer>
      </main>
    </div>
  );
}
