import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  CONTRACT_ADDRESS,
  CONTRACT_EXPLORER_URL,
  EXPECTED_CONTRACT_VERSION,
  EXPECTED_SEMANTIC_BUDGET,
  SOURCE_SHA256,
} from './config';
import {
  acceptDutyTx,
  cleanError,
  connectWallet,
  countersignDeterminationTx,
  createAgreementTx,
  executionErrorDetail,
  genToWei,
  getAgreement,
  getAttempt,
  getAttempts,
  getConfig,
  getDetermination,
  proposeDeterminationTx,
  refundEscrowTx,
  releaseEscrowTx,
  txExplorerUrl,
  waitFinalized,
  weiToGen,
} from './genlayer';
import type {
  Address,
  Agreement,
  Attempt,
  Determination,
  GuardConfig,
  TxView,
} from './types';

type Page = 'overview' | 'create' | 'agreement' | 'propose' | 'audit' | 'verification';

const PAGES: Array<{ id: Page; label: string; kicker: string }> = [
  { id: 'overview', label: 'Overview', kicker: 'Protocol' },
  { id: 'create', label: 'Create agreement', kicker: 'Escrow' },
  { id: 'agreement', label: 'Agreement', kicker: 'State' },
  { id: 'propose', label: 'Determination', kicker: 'Decision' },
  { id: 'audit', label: 'Attempt log', kicker: 'Audit' },
  { id: 'verification', label: 'Verification', kicker: 'Proof' },
];

const WINDOW_CHOICES: Array<{ label: string; seconds: number }> = [
  { label: '15 minutes', seconds: 900 },
  { label: '30 minutes', seconds: 1800 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
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

function statusClass(status?: string) {
  if (status === 'ACTIVE') return 'verdict good';
  if (status === 'RELEASED') return 'verdict good';
  if (status === 'REFUNDED') return 'verdict blocked';
  return 'verdict neutral';
}

function deadlineText(unix: number) {
  if (!unix) return '—';
  const when = new Date(unix * 1000);
  const overdue = Date.now() / 1000 >= unix;
  return `${when.toISOString().replace('T', ' ').slice(0, 16)} UTC${overdue ? ' · elapsed' : ''}`;
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

  const [agreementIdInput, setAgreementIdInput] = useState('');
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [activeDetermination, setActiveDetermination] = useState<Determination | null>(null);
  const [latestAttempt, setLatestAttempt] = useState<Attempt | null>(null);

  const [partyInput, setPartyInput] = useState('');
  const [dutyInput, setDutyInput] = useState('');
  const [escrowInput, setEscrowInput] = useState('');
  const [windowInput, setWindowInput] = useState(String(WINDOW_CHOICES[3].seconds));
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

  const loadAgreement = useCallback(async (id: number, quiet = false) => {
    if (!Number.isInteger(id) || id <= 0) {
      if (!quiet) setNotice('Enter an agreement ID greater than zero.');
      return null;
    }

    try {
      const next = await getAgreement(id);
      setAgreement(next);
      setAgreementIdInput(String(id));

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

      if (!quiet) setNotice(`Loaded Agreement #${id} from finalized state.`);
      return next;
    } catch (error) {
      setAgreement(null);
      setAttempts([]);
      setActiveDetermination(null);
      setLatestAttempt(null);
      if (!quiet) setNotice(cleanError(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((value) => {
        const accounts = value as string[];
        if (accounts?.[0]) setAccount(accounts[0] as Address);
      })
      .catch(() => undefined);
  }, []);

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
      config.name === 'AuthoritySplit' &&
      config.version === EXPECTED_CONTRACT_VERSION &&
      config.max_semantic_evals_per_agreement === EXPECTED_SEMANTIC_BUDGET,
  );

  const isObligee = sameAddress(account, agreement?.obligee);
  const isResponsible = sameAddress(account, agreement?.responsible_party);
  const isParty = isObligee || isResponsible;
  const isActive = agreement?.status === 'ACTIVE';
  const hasPending = Boolean(agreement?.pending_clause_text);
  const pendingIsMine = sameAddress(account, agreement?.pending_proposed_by);
  const escrowLocked = Boolean(
    agreement && (agreement.status === 'AWAITING_ACCEPTANCE' || agreement.status === 'ACTIVE'),
  );
  const determinationInForce = Boolean(agreement && agreement.active_determination_id > 0);
  const refundDue = Boolean(
    agreement && agreement.refund_deadline_unix > 0 &&
      Date.now() / 1000 >= agreement.refund_deadline_unix,
  );
  const semanticBudgetRemaining =
    agreement && config
      ? Math.max(0, config.max_semantic_evals_per_agreement - agreement.semantic_eval_count)
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

  /**
   * One write path for every transaction.
   *
   * `send` submits, `verify` re-reads finalized state and throws if the
   * postcondition this specific action promises is not present. A finalized
   * transaction is never reported as success on its own.
   */
  async function runWrite(
    label: string,
    send: () => Promise<`0x${string}`>,
    verify: (hash: `0x${string}`) => Promise<string>,
  ) {
    if (busy) return;
    setBusy(true);
    setTx({ phase: 'SUBMITTED', label, message: 'Preparing transaction…' });
    try {
      const hash = await send();
      setTx({ phase: 'SUBMITTED', label, hash, message: 'Submitted. Waiting for finalization…' });
      const receipt = await waitFinalized(hash);
      setTx({
        phase: 'FINALIZED',
        label,
        hash,
        message: 'Finalized. Verifying contract state…',
      });

      // The finalized postcondition is the only thing allowed to decide whether
      // this action succeeded. Receipt field names are not something this app
      // should guess — guessing once already reported a successful accept_duty
      // as a refusal — so the receipt is consulted only after a postcondition
      // has failed, and then only to recover the contract's own wording.
      let summary: string;
      try {
        summary = await verify(hash);
      } catch (postcondition) {
        throw new Error(executionErrorDetail(receipt, '') || cleanError(postcondition));
      }

      setTx({ phase: 'VERIFIED', label, hash, message: summary });
      setNotice(summary);
    } catch (error) {
      setTx((current) => ({
        phase: 'ERROR',
        label,
        hash: current?.hash,
        message: cleanError(error),
      }));
      setNotice(cleanError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!account) return setNotice('Connect the obligee wallet first.');
    const party = partyInput.trim();
    const duty = dutyInput.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(party)) {
      return setNotice('The responsible party must be a 0x address, not a name.');
    }
    if (!duty) return setNotice('The duty text is required.');

    let parsed: bigint | null = null;
    let parseError = '';
    try {
      parsed = genToWei(escrowInput);
    } catch (error) {
      parseError = cleanError(error);
    }
    if (parsed === null) return setNotice(parseError);
    if (parsed <= 0n) return setNotice('Escrow must be greater than zero.');
    const escrowWei: bigint = parsed;

    const seconds = Number(windowInput);

    let countBefore = 0;
    try {
      countBefore = (await getConfig()).agreement_count;
    } catch (error) {
      return setNotice(`Could not read the contract before writing: ${cleanError(error)}`);
    }

    await runWrite(
      'Create agreement',
      () => createAgreementTx(account, party, duty, seconds, escrowWei),
      async () => {
        const after = await getConfig();
        if (after.agreement_count !== countBefore + 1) {
          throw new Error('Finalized create did not increase agreement_count by exactly one.');
        }
        const created = await getAgreement(after.agreement_count);
        if (
          !sameAddress(created.obligee, account) ||
          !sameAddress(created.responsible_party, party) ||
          created.duty_text !== duty ||
          created.escrow_wei !== escrowWei.toString() ||
          created.status !== 'AWAITING_ACCEPTANCE'
        ) {
          throw new Error('Finalized agreement state does not match what was submitted.');
        }
        setConfig(after);
        setPartyInput('');
        setDutyInput('');
        setEscrowInput('');
        await loadAgreement(created.agreement_id, true);
        go('agreement');
        return `Agreement #${created.agreement_id} created with ${weiToGen(created.escrow_wei)} GEN in escrow, awaiting acceptance.`;
      },
    );
  }

  async function handleAccept() {
    if (!account || !agreement) return;
    const id = agreement.agreement_id;
    const before = agreement;
    await runWrite(
      'Accept duty',
      () => acceptDutyTx(account, id),
      async () => {
        const after = await loadAgreement(id, true);
        if (!after) throw new Error('Could not re-read the agreement after finalization.');
        if (before.accepted || after.accepted !== true || after.status !== 'ACTIVE') {
          throw new Error(
            'The duty was not accepted by this transaction. The contract refused it: ' +
              (before.accepted
                ? 'the agreement was already accepted.'
                : 'only the named responsible party may accept the duty.'),
          );
        }
        return `Agreement #${id} is ACTIVE. Both wallets are now bound to the same duty text.`;
      },
    );
  }

  async function handlePropose(event: FormEvent) {
    event.preventDefault();
    if (!account) return setNotice('Connect a wallet first.');
    if (!agreement) return setNotice('Load an agreement first.');
    const candidate = candidateInput.trim();
    if (!candidate) return setNotice('Enter a proposed determination clause.');

    const id = agreement.agreement_id;
    const before = agreement;

    await runWrite(
      'Propose determination',
      () => proposeDeterminationTx(account, id, candidate),
      async () => {
        const after = await loadAgreement(id, true);
        if (!after) throw new Error('Could not re-read the agreement after finalization.');
        if (after.attempt_count !== before.attempt_count + 1) {
          throw new Error('Finalized proposal did not create exactly one attempt.');
        }
        const attempt = await getAttempt(id, after.attempt_count);
        setLatestAttempt(attempt);

        if (attempt.verdict === 'INDEPENDENT_DETERMINATION') {
          if (!after.pending_clause_text) {
            throw new Error('An independent verdict did not leave a clause awaiting signature.');
          }
          if (after.active_determination_id !== before.active_determination_id) {
            throw new Error('Consensus activated a determination without a countersignature.');
          }
        } else if (attempt.verdict === 'SELF_JUDGING_AUTHORITY') {
          if (
            attempt.accepted ||
            attempt.resulting_determination_id !== 0 ||
            after.self_judging_blocks !== before.self_judging_blocks + 1 ||
            after.pending_clause_text !== ''
          ) {
            throw new Error('A self-judging verdict did not produce the required blocked state.');
          }
        } else {
          throw new Error(`Unexpected stored verdict: ${attempt.verdict}`);
        }

        setCandidateInput('');
        await loadConfig();
        return `${verdictLabel(attempt.verdict)} · ${
          attempt.used_cache ? 'cache hit' : 'fresh consensus'
        } · ${
          attempt.verdict === 'INDEPENDENT_DETERMINATION'
            ? 'awaiting the other party’s signature'
            : 'blocked, no clause stored'
        }.`;
      },
    );
  }

  async function handleCountersign() {
    if (!account || !agreement) return;
    const id = agreement.agreement_id;
    const before = agreement;
    await runWrite(
      'Countersign clause',
      () => countersignDeterminationTx(account, id),
      async () => {
        const after = await loadAgreement(id, true);
        if (!after) throw new Error('Could not re-read the agreement after finalization.');
        if (after.active_determination_id <= before.active_determination_id) {
          throw new Error('The countersignature did not activate a determination.');
        }
        if (after.pending_clause_text !== '') {
          throw new Error('The pending clause was not consumed.');
        }
        return `Determination #${after.active_determination_id} (v${after.active_version}) is in force. Escrow can now be released.`;
      },
    );
  }

  async function handleRelease() {
    if (!account || !agreement) return;
    const id = agreement.agreement_id;
    const before = agreement;
    await runWrite(
      'Release escrow',
      () => releaseEscrowTx(account, id),
      async () => {
        const after = await loadAgreement(id, true);
        if (!after) throw new Error('Could not re-read the agreement after finalization.');
        if (before.status === 'RELEASED' || after.status !== 'RELEASED' || after.escrow_wei !== '0') {
          throw new Error(
            'The escrow did not move. The contract refused this: ' +
              (before.active_determination_id === 0
                ? 'no independent determination clause is in force.'
                : before.status !== 'ACTIVE'
                  ? 'the agreement is not active.'
                  : 'only the obligee may release escrow.'),
          );
        }
        return `Escrow paid to the responsible party. Agreement #${id} is RELEASED.`;
      },
    );
  }

  async function handleRefund() {
    if (!account || !agreement) return;
    const id = agreement.agreement_id;
    const before = agreement;
    await runWrite(
      'Reclaim escrow',
      () => refundEscrowTx(account, id),
      async () => {
        const after = await loadAgreement(id, true);
        if (!after) throw new Error('Could not re-read the agreement after finalization.');
        if (before.status === 'REFUNDED' || after.status !== 'REFUNDED' || after.escrow_wei !== '0') {
          throw new Error(
            'The escrow did not move. The contract refused this: ' +
              (before.active_determination_id > 0
                ? 'an independent determination clause is already in force.'
                : !refundDue
                  ? 'the refund deadline has not passed.'
                  : 'only the obligee may reclaim escrow, and only before settlement.'),
          );
        }
        return `Escrow returned to the obligee. Agreement #${id} is REFUNDED.`;
      },
    );
  }

  /**
   * The four state-changing buttons on the agreement page.
   *
   * `blocked` is structural only — the page has nothing to send. `refusal`
   * predicts what the contract will say, and the button stays live so a reviewer
   * can send the transaction and read the refusal from the chain rather than
   * from this app. Every rule in the spec is reachable this way.
   */
  const ACTIONS = [
    {
      key: 'accept',
      title: 'Accept the duty',
      body: 'Responsible party only. This is the second signature; it moves the agreement to ACTIVE.',
      label: 'Accept duty',
      tone: 'primary',
      blocked: () => !agreement,
      refusal: () => {
        if (!agreement) return null;
        if (agreement.status !== 'AWAITING_ACCEPTANCE') return 'the agreement is not awaiting acceptance.';
        if (!isResponsible) return 'only the named responsible party may accept the duty.';
        return null;
      },
      run: handleAccept,
    },
    {
      key: 'countersign',
      title: 'Countersign the pending clause',
      body: 'The party that did not propose it. Consensus alone never puts a clause in force.',
      label: 'Countersign',
      tone: 'primary',
      blocked: () => !agreement,
      refusal: () => {
        if (!agreement) return null;
        if (!isActive) return 'the agreement is not active.';
        if (!hasPending) return 'no determination clause is awaiting signature.';
        if (!isParty) return 'only a party to this agreement may countersign.';
        if (pendingIsMine) return 'the proposing party cannot countersign its own clause.';
        return null;
      },
      run: handleCountersign,
    },
    {
      key: 'release',
      title: 'Release escrow to the responsible party',
      body: 'Obligee only, and only while an independent determination clause is in force.',
      label: agreement ? `Release ${weiToGen(agreement.escrow_wei)} GEN` : 'Release escrow',
      tone: 'primary',
      blocked: () => !agreement,
      refusal: () => {
        if (!agreement) return null;
        if (!isObligee) return 'only the obligee may release escrow.';
        if (!isActive) return 'the agreement is not active.';
        if (!determinationInForce) return 'no independent determination clause is in force.';
        return null;
      },
      run: handleRelease,
    },
    {
      key: 'refund',
      title: 'Reclaim escrow',
      body: 'Obligee only, after the refund window, and only while no determination is in force.',
      label: 'Reclaim',
      tone: 'secondary',
      blocked: () => !agreement,
      refusal: () => {
        if (!agreement) return null;
        if (!isObligee) return 'only the obligee may reclaim escrow.';
        if (!escrowLocked) return 'the agreement is already settled.';
        if (determinationInForce) return 'an independent determination clause is already in force.';
        if (!refundDue) return 'the refund deadline has not passed.';
        return null;
      },
      run: handleRefund,
    },
  ];

  const agreementTitle = agreement ? `Agreement #${agreement.agreement_id}` : 'No agreement loaded';

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
            {agreement && (
              <button className="workspace-pill" type="button" onClick={() => go('agreement')}>
                <span>OPEN</span> Agreement #{agreement.agreement_id}
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
                  <span className="hero-kicker">ESCROW GATED BY A META-RIGHT</span>
                  <h1>Money should not move through a contract someone <em>grades themselves</em>.</h1>
                  <p>
                    Two wallets sign one duty and lock real GEN behind it. Either may propose the clause
                    that decides who judges compliance. GenLayer validators answer one narrow question
                    about that clause, and the contract refuses to pay out until the answer is independent.
                  </p>
                  <div className="hero-actions">
                    <button type="button" className="primary" onClick={() => go('create')}>Create agreement <span>→</span></button>
                    <button type="button" className="secondary" onClick={() => go('agreement')}>Inspect state</button>
                  </div>
                </div>
                <div className="authority-diagram" aria-label="Authority separation diagram">
                  <div className="diagram-top">
                    <span>RESPONSIBLE PARTY</span>
                    <strong>Duty holder · escrow payee</strong>
                  </div>
                  <div className="diagram-axis"><i /><b>FINAL DETERMINATION</b><i /></div>
                  <div className="diagram-choices">
                    <div className="choice blocked"><span>ESCROW FROZEN</span><strong>Unilateral control</strong><small>SELF_JUDGING_AUTHORITY</small></div>
                    <div className="choice good"><span>ESCROW RELEASABLE</span><strong>Independent authority</strong><small>INDEPENDENT_DETERMINATION</small></div>
                  </div>
                </div>
              </section>

              <section className="stats-band">
                <Metric label="Agreements" value={config?.agreement_count ?? '—'} note="finalized state" />
                <Metric label="Determinations" value={config?.determination_count ?? '—'} note="countersigned versions" />
                <Metric label="Semantic budget" value={config ? `${config.max_semantic_evals_per_agreement} / agreement` : '—'} note="fresh classifications" />
                <Metric label="Contract version" value={config?.version ?? '—'} note={sourceParityOk ? 'expected profile' : 'verify live'} />
              </section>

              <section className="overview-grid">
                <article className="panel rule-panel">
                  <SectionHead eyebrow="THE FLOW" title="Six writes, one gate." />
                  <div className="rule-lines">
                    <div><span>01</span><p>The obligee escrows GEN and names a different wallet as responsible party.</p></div>
                    <div><span>02</span><p>That wallet accepts the duty. Two signatures, one immutable duty text.</p></div>
                    <div><span>03</span><p>Either party proposes the clause that decides who judges compliance.</p></div>
                    <div><span>04</span><p>Validators classify only that clause. Self-judging is blocked permanently.</p></div>
                    <div><span>05</span><p>The other party countersigns. Consensus alone activates nothing.</p></div>
                    <div><span>06</span><p>Escrow releases only while an independent determination is in force.</p></div>
                  </div>
                </article>
                <article className="panel boundary-panel">
                  <SectionHead eyebrow="NOT AN ORACLE" title="What the contract does not decide." />
                  <div className="boundary-tags">
                    <span>Whether performance actually occurred</span>
                    <span>Whether a duty is fair</span>
                    <span>Damages or remedies</span>
                    <span>External facts not in the clause</span>
                    <span>Who wins a dispute</span>
                  </div>
                  <div className="guard-note">
                    <span>MUTUAL CONSENT IS NOT A BYPASS</span>
                    <p>
                      A blocked clause cannot be countersigned into force. The responsible party cannot
                      obtain the right to judge itself by persuading its counterparty to sign.
                    </p>
                  </div>
                </article>
              </section>
            </>
          )}

          {page === 'create' && (
            <section className="two-col-page">
              <div>
                <SectionHead
                  eyebrow="CREATE AGREEMENT"
                  title="Lock the escrow before testing the decision authority."
                  body="The caller becomes the obligee and funds the escrow. The responsible party is an address, not a label, and it must be a different wallet. Forms start empty by design."
                />
                <div className="guard-note">
                  <span>IMMUTABLE CONTEXT</span>
                  <p>The duty text is frozen at creation and becomes the semantic context for every later determination clause in this agreement.</p>
                </div>
                <div className="semantic-boundary">
                  <span>REFUND WINDOW</span>
                  <p>
                    If no independent determination is ever established, the obligee may reclaim the
                    escrow after this window elapses. Once a determination is in force, the refund path
                    closes and only release remains.
                  </p>
                </div>
              </div>
              <form className="panel form-panel" onSubmit={handleCreate}>
                <label>
                  <span>Responsible party address</span>
                  <input
                    value={partyInput}
                    onChange={(e) => setPartyInput(e.target.value.trim())}
                    placeholder="e.g. 0x1234…abcd (a different wallet)"
                    maxLength={42}
                    disabled={busy}
                  />
                  <small>{/^0x[0-9a-fA-F]{40}$/.test(partyInput) ? 'Valid address' : '20-byte 0x address required'}</small>
                </label>
                <label>
                  <span>Immutable duty</span>
                  <textarea
                    value={dutyInput}
                    onChange={(e) => setDutyInput(e.target.value)}
                    placeholder="e.g. The vendor must restore critical incidents within four hours of a reported outage."
                    maxLength={4000}
                    rows={7}
                    disabled={busy}
                  />
                  <small>{dutyInput.length} / 4000</small>
                </label>
                <label>
                  <span>Escrow amount (GEN)</span>
                  <input
                    value={escrowInput}
                    onChange={(e) => setEscrowInput(e.target.value)}
                    placeholder="e.g. 0.01"
                    inputMode="decimal"
                    disabled={busy}
                  />
                  <small>Sent with the transaction and held by the contract.</small>
                </label>
                <label>
                  <span>Refund window</span>
                  <select
                    value={windowInput}
                    onChange={(e) => setWindowInput(e.target.value)}
                    disabled={busy}
                  >
                    {WINDOW_CHOICES.map((choice) => (
                      <option key={choice.seconds} value={choice.seconds}>{choice.label}</option>
                    ))}
                  </select>
                  <small>Measured from the consensus clock, not the browser clock.</small>
                </label>
                {account && sameAddress(partyInput, account) && (
                  <p className="will-refuse">
                    The contract will refuse this: the responsible party must differ from the
                    obligee. Send it anyway to see the refusal come back from the chain.
                  </p>
                )}
                <div className="form-footer">
                  <div><span>Obligee wallet</span><strong>{account ? short(account, 9, 7) : 'Connect wallet first'}</strong></div>
                  <button className="primary" type="submit" disabled={busy || !account}>Fund and create →</button>
                </div>
              </form>
            </section>
          )}

          {page === 'agreement' && (
            <>
              <section className="workspace-hero">
                <div>
                  <SectionHead eyebrow="FINALIZED STATE" title={agreementTitle} body="Open any agreement ID. Every read is requested from finalized contract state." />
                </div>
                <form
                  className="workspace-loader"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadAgreement(Number(agreementIdInput));
                  }}
                >
                  <input
                    inputMode="numeric"
                    value={agreementIdInput}
                    onChange={(e) => setAgreementIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Agreement ID"
                  />
                  <button type="submit" className="secondary">Open</button>
                </form>
              </section>

              {agreement ? (
                <>
                  <section className="workspace-grid">
                    <article className="panel duty-card">
                      <div className="card-meta">
                        <span>DUTY</span>
                        <b className={statusClass(agreement.status)}>{agreement.status}</b>
                      </div>
                      <blockquote>{agreement.duty_text}</blockquote>
                      <div className="authority-line">
                        <span>Obligee · pays</span>
                        <strong>{isObligee ? 'Connected wallet' : short(agreement.obligee, 9, 7)}</strong>
                      </div>
                      <div className="authority-line">
                        <span>Responsible party · owes the duty</span>
                        <strong>{isResponsible ? 'Connected wallet' : short(agreement.responsible_party, 9, 7)}</strong>
                      </div>
                      <div className="authority-line">
                        <span>Escrow held</span>
                        <strong>{weiToGen(agreement.escrow_wei)} GEN {escrowLocked ? '· locked' : ''}</strong>
                      </div>
                      <div className="authority-line">
                        <span>Refund window ends</span>
                        <strong>{deadlineText(agreement.refund_deadline_unix)}</strong>
                      </div>
                    </article>

                    <article className="panel determination-card">
                      <div className="card-meta"><span>ACTIVE DETERMINATION</span><b>v{agreement.active_version}</b></div>
                      {determinationInForce ? (
                        <>
                          <span className="verdict good">INDEPENDENT · IN FORCE</span>
                          <h3>Determination #{agreement.active_determination_id}</h3>
                          <blockquote>{agreement.active_determination_text}</blockquote>
                          <small>
                            Proposed by {short(agreement.active_proposed_by, 8, 6)}, countersigned by{' '}
                            {short(agreement.active_countersigned_by, 8, 6)}
                            {activeDetermination ? ` · from attempt #${activeDetermination.from_attempt}` : ''}
                          </small>
                        </>
                      ) : hasPending ? (
                        <>
                          <span className="verdict neutral">AWAITING SIGNATURE</span>
                          <h3>Clause passed consensus</h3>
                          <blockquote>{agreement.pending_clause_text}</blockquote>
                          <small>Proposed by {short(agreement.pending_proposed_by, 8, 6)} · the other party must countersign.</small>
                        </>
                      ) : (
                        <div className="empty-card">
                          <span>∅</span>
                          <strong>No determination in force</strong>
                          <p>Escrow cannot be released until an independent clause is countersigned.</p>
                        </div>
                      )}
                    </article>
                  </section>

                  <section className="counter-grid">
                    <Metric label="Attempts" value={agreement.attempt_count} note={`cap ${config?.max_attempts_per_agreement ?? 100}`} />
                    <Metric label="Fresh semantic evals" value={agreement.semantic_eval_count} note={`${semanticBudgetRemaining} remaining`} />
                    <Metric label="Blocked self-judging" value={agreement.self_judging_blocks} note="deterministic consequence" />
                    <Metric label="Countersigned versions" value={agreement.version_count} note={`cap ${config?.max_determination_versions ?? 20}`} />
                  </section>

                  <section className="panel escrow-actions">
                    <SectionHead
                      eyebrow="CONSEQUENCE"
                      title="What this wallet may do right now"
                      body="A button is disabled only when this page cannot build the call at all. Every rule below belongs to the contract, so the interface predicts the refusal and still lets you send it — the gate you see is the chain's, not this app's."
                    />
                    {ACTIONS.map((action) => {
                      const refusal = action.refusal();
                      return (
                        <div className="action-row" key={action.key}>
                          <div>
                            <strong>{action.title}</strong>
                            <p>{action.body}</p>
                            {refusal && (
                              <p className="will-refuse">
                                The contract will refuse this: {refusal}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            className={action.tone}
                            disabled={busy || !account || action.blocked()}
                            onClick={() => void action.run()}
                          >
                            {action.label}
                          </button>
                        </div>
                      );
                    })}
                  </section>

                  <section className="workspace-actions">
                    <button type="button" className="primary" onClick={() => go('propose')}>Propose determination →</button>
                    <button type="button" className="secondary" onClick={() => go('audit')}>Open attempt log</button>
                  </section>
                </>
              ) : (
                <div className="empty-state-large">
                  <span>AGREEMENT</span>
                  <h3>Open a finalized agreement to inspect its authority boundary and escrow.</h3>
                  <p>No local browser state is ever used as evidence.</p>
                </div>
              )}
            </>
          )}

          {page === 'propose' && (
            <section className="two-col-page propose-page">
              <div>
                <SectionHead
                  eyebrow="PROPOSE DETERMINATION"
                  title="Who controls the final answer?"
                  body="The semantic call does not decide whether the duty was met. It classifies one thing: unilateral decisive control over the final compliance determination."
                />
                {agreement ? (
                  <div className="context-card">
                    <div><span>Agreement</span><strong>#{agreement.agreement_id}</strong></div>
                    <div><span>Status</span><strong>{agreement.status}</strong></div>
                    <div><span>Escrow at stake</span><strong>{weiToGen(agreement.escrow_wei)} GEN</strong></div>
                    <div><span>Fresh semantic budget</span><strong>{semanticBudgetRemaining} remaining</strong></div>
                    <div>
                      <span>Connected role</span>
                      <strong className={isParty ? 'role-ok' : 'role-bad'}>
                        {isObligee ? 'Obligee' : isResponsible ? 'Responsible party' : 'Read only'}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <button className="secondary wide" type="button" onClick={() => go('agreement')}>Load an agreement first</button>
                )}
                <div className="semantic-boundary">
                  <span>SEMANTIC QUESTION</span>
                  <p>Can the responsible party, acting alone, determine, prevent, veto, override, appoint, replace, or otherwise control the final compliance outcome?</p>
                </div>
              </div>

              <form className="panel form-panel proposal-form" onSubmit={handlePropose}>
                <label>
                  <span>Agreement ID</span>
                  <input value={agreement?.agreement_id ?? ''} readOnly placeholder="Load an agreement" />
                </label>
                <label>
                  <span>Candidate determination clause</span>
                  <textarea
                    value={candidateInput}
                    onChange={(e) => setCandidateInput(e.target.value)}
                    placeholder="e.g. Restoration completion is determined by a third-party monitoring service jointly selected by both parties."
                    maxLength={4000}
                    rows={11}
                    disabled={busy || !agreement}
                  />
                  <small>{candidateInput.length} / 4000</small>
                </label>
                {agreement && !isParty && (
                  <p className="will-refuse">
                    The contract will refuse this: only a party to this agreement may propose.
                    Send it anyway to see the refusal come back from the chain.
                  </p>
                )}
                {agreement && isParty && !isActive && (
                  <p className="will-refuse">
                    The contract will refuse this: the agreement is not active.
                  </p>
                )}
                <div className="form-footer stacked-mobile">
                  <div>
                    <span>Expected outcome</span>
                    <strong>
                      {!agreement
                        ? 'Load agreement'
                        : !isParty
                          ? 'Refused — not a party'
                          : !isActive
                            ? 'Refused — not active'
                            : 'Sent to consensus'}
                    </strong>
                  </div>
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || !agreement || !account || !candidateInput.trim()}
                  >
                    Run determination →
                  </button>
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
                    <div><span>Consequence</span><strong>{latestAttempt.accepted ? 'Awaiting countersignature' : 'Blocked'}</strong></div>
                    <div><span>Semantic source</span><strong>{latestAttempt.used_cache ? 'Cache hit' : 'Fresh consensus'}</strong></div>
                    <div><span>Escrow</span><strong>{determinationInForce ? 'Releasable' : 'Frozen'}</strong></div>
                  </div>
                </article>
              )}
            </section>
          )}

          {page === 'audit' && (
            <>
              <section className="workspace-hero">
                <div>
                  <SectionHead
                    eyebrow="ATTEMPT LOG"
                    title={agreement ? `Agreement #${agreement.agreement_id} audit trail` : 'Load an agreement'}
                    body="Stored verdicts, the consequence each produced, and whether the per-agreement semantic cache was reused."
                  />
                </div>
                {!agreement && <button type="button" className="secondary" onClick={() => go('agreement')}>Open agreement</button>}
              </section>

              {agreement && (
                <section className="audit-layout">
                  <div className="audit-summary panel">
                    <Metric label="Attempts" value={agreement.attempt_count} />
                    <Metric label="Fresh evals" value={agreement.semantic_eval_count} />
                    <Metric label="Cache reuses" value={Math.max(0, agreement.attempt_count - agreement.semantic_eval_count)} />
                    <Metric label="Blocked" value={agreement.self_judging_blocks} />
                  </div>
                  <div className="attempt-table panel">
                    <div className="table-head"><span>ID</span><span>Verdict</span><span>Consequence</span><span>Semantic</span></div>
                    {attempts.length ? attempts.map((attempt) => (
                      <div className="table-row" key={attempt.attempt_id}>
                        <strong>#{attempt.attempt_id}</strong>
                        <span className={verdictClass(attempt.verdict)}>
                          {attempt.verdict === 'INDEPENDENT_DETERMINATION' ? 'INDEPENDENT' : 'SELF-JUDGING'}
                        </span>
                        <span>
                          {attempt.resulting_determination_id
                            ? `Determination #${attempt.resulting_determination_id}`
                            : attempt.accepted
                              ? 'Passed to signature'
                              : 'Blocked'}
                        </span>
                        <span className={attempt.used_cache ? 'cache-hit' : 'cache-fresh'}>
                          {attempt.used_cache ? 'CACHE HIT' : 'FRESH'}
                        </span>
                      </div>
                    )) : <div className="table-empty">No attempts recorded in this agreement.</div>}
                  </div>
                </section>
              )}
            </>
          )}

          {page === 'verification' && (
            <>
              <section className="verification-hero">
                <SectionHead
                  eyebrow="VERIFICATION"
                  title="One address. One source hash. Every claim re-runnable."
                  body="The frontend targets the same contract source the Direct Mode suite and the mutation matrix run against. The hash below is checked by npm run verify."
                />
              </section>

              <section className="verification-grid">
                <article className="panel verify-card">
                  <span>PROJECT ADDRESS</span>
                  <h3>{short(CONTRACT_ADDRESS, 12, 10)}</h3>
                  <p>The deployed AuthoritySplit this interface reads and writes.</p>
                  <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">Open on the explorer ↗</a>
                </article>
                <article className="panel verify-card">
                  <span>LIVE PROFILE</span>
                  <h3>{config ? `${config.name} v${config.version}` : 'Reading…'}</h3>
                  <p>
                    {sourceParityOk
                      ? `Semantic budget ${config?.max_semantic_evals_per_agreement} per agreement, no global admin.`
                      : 'The live contract profile has not matched the expected source profile yet.'}
                  </p>
                </article>
              </section>

              <section className="panel source-card">
                <div>
                  <span className="eyebrow">CONTRACT SOURCE SHA256</span>
                  <code>{SOURCE_SHA256}</code>
                </div>
                <button type="button" className="secondary" onClick={() => void copyText(SOURCE_SHA256)}>Copy hash</button>
              </section>

              <section className="proof-list">
                <div><span>01</span><strong>Self-judging consequence</strong><p>A clause giving the responsible party sole discretion stores SELF_JUDGING_AUTHORITY, increments the block counter, and leaves nothing pending.</p><b>TESTED</b></div>
                <div><span>02</span><strong>Consensus does not activate</strong><p>An INDEPENDENT_DETERMINATION verdict only queues the clause for signature. The active determination is unchanged until the other party countersigns.</p><b>TESTED</b></div>
                <div><span>03</span><strong>Escrow is gated by the verdict</strong><p>release_escrow is refused while no independent determination is in force, and refund_escrow is refused once one is.</p><b>TESTED</b></div>
                <div><span>04</span><strong>Mutual consent is not a bypass</strong><p>A blocked clause cannot be countersigned into force by agreement between the two parties.</p><b>TESTED</b></div>
                <div><span>05</span><strong>Reroll prevention and isolation</strong><p>An exact resubmission reuses the cached verdict without spending budget; the same clause in another agreement is classified fresh.</p><b>TESTED</b></div>
                <div><span>06</span><strong>Prompt fence</strong><p>A clause that forges the CANDIDATE_CLAUSE boundary is neutralised before the model sees it, proven by detector mocks that fire only on a leak.</p><b>TESTED</b></div>
              </section>

              <section className="guard-note">
                <span>HOW TO RE-RUN</span>
                <p>
                  <code>pytest tests/direct</code> executes 34 checks on a pinned GenVM build.
                  <code>python3 scripts/mutation_matrix.py</code> breaks the contract twenty ways and
                  requires the suite to fail on every one. See TESTING.md.
                </p>
              </section>
            </>
          )}
        </div>

        <footer>
          <div><img className="brand-logo small" src="/logo.svg" alt="" aria-hidden="true" /><strong>AuthoritySplit</strong></div>
          <p>Semantic classification is narrow. Consequences are deterministic. Escrow is real.</p>
          <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">StudioNet ↗</a>
        </footer>
      </main>
    </div>
  );
}
