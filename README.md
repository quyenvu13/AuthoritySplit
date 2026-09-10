# AuthoritySplit

<p align="center"><img src="public/AuthoritySplit-logo-512.png" alt="AuthoritySplit logo" width="180" /></p>

**Escrowed funds cannot move through an agreement whose compliance verdict the obligor controls.**

Two wallets sign one immutable duty and lock real GEN behind it. Either party may
propose the *determination clause* — the rule that decides who judges whether the
duty was met. GenLayer validators answer exactly one question about that clause:

> Does it give the responsible party, or anything the responsible party controls
> unilaterally, decisive power over the final determination of its own compliance?

`SELF_JUDGING_AUTHORITY` blocks the clause permanently and **mutual consent cannot
override it** — the responsible party cannot buy the right to judge itself by
persuading its counterparty to sign. `INDEPENDENT_DETERMINATION` only queues the
clause for the other party's signature; consensus alone activates nothing.

Escrow releases only while an independent determination is in force. That is the
consequence: not a counter, not a log entry — the money.

---

## The flow

| # | Write | Caller | What it does |
|---|---|---|---|
| 1 | `create_agreement(responsible_party_hex, duty_text, refund_window_seconds)` | obligee, payable | Locks escrow, names a **different** wallet as responsible party, freezes the duty text, starts the refund window. |
| 2 | `accept_duty(agreement_id)` | responsible party | The second signature. `AWAITING_ACCEPTANCE → ACTIVE`. |
| 3 | `propose_determination(agreement_id, candidate_clause)` | either party | The one semantic call. Blocks a self-judging clause; queues an independent one. |
| 4 | `countersign_determination(agreement_id)` | the *other* party | Puts the queued clause in force as a new version. The proposer cannot sign its own. |
| 5 | `release_escrow(agreement_id)` | obligee | Pays the responsible party. **Refused unless a determination is in force.** |
| 6 | `refund_escrow(agreement_id)` | obligee | Returns the escrow after the window. **Refused once a determination is in force.** |

Reads: `get_config`, `get_agreement`, `get_determination`, `get_attempt`,
`get_attempts` — all return JSON strings from finalized state.

## Why this needs GenLayer

The question is about meaning, not about data. "Determined by the vendor in its
sole discretion" and "determined by a monitoring service the vendor may replace at
will" are different sentences with the same meta-right; "determined by a
jointly-appointed auditor whose findings are final" is the opposite. No keyword
list separates those, and no oracle can be asked. A validator reading the clause
can.

Everything downstream of that one answer is deterministic contract code: which
counter moves, which clause becomes active, and whether the escrow may leave.

## Honest scope

AuthoritySplit does **not** decide:

- whether the duty was actually performed;
- whether the duty is fair, lawful, or commercially reasonable;
- damages, remedies, or who should win a dispute;
- any external fact that is not written in the clause itself.

Two further limits, stated because a reviewer would find them anyway:

- **The classification is of text, not of the world.** A clause naming an
  "independent auditor" that the responsible party secretly controls is classified
  from what the clause says. The contract cannot see the off-chain relationship.
- **The semantic layer is bounded.** Eight fresh classifications per agreement,
  after which proposals are refused rather than re-judged, and identical
  resubmissions reuse the cached verdict instead of rerolling it. This is the
  anti-verdict-shopping property; it also means the model is consulted far less
  often than the attempt count suggests.

The prompt fence neutralises angle brackets and strips the verdict labels from the
model-facing copy of user text. It is hardening, not a proof of injection
resistance; validator reruns provide the convergence discipline.

## Deployment

| | |
|---|---|
| Contract | `contracts/AuthoritySplit.py` |
| Source SHA-256 | `d1ff73c8a650f8932a50046fb03c17aa0acedf9d40890091002d47bea4a860f6` |
| Contract version | `2.0` (`get_config().version`) |
| Network | GenLayer StudioNet (chain `61999`) |
| Address | [`0x7906B2F82C7c217f9321789CB53fb293a02e3B38`](https://explorer-studio.genlayer.com/address/0x7906B2F82C7c217f9321789CB53fb293a02e3B38) |

`npm run verify` recomputes the contract hash and fails if `src/config.ts`, the
contract version, the semantic budget, or `FINAL_CHECKSUMS.txt` disagree with it.

## The primitive, in two transactions

Both were sent by the **same wallet**, calling the **same method**, on the **same
agreement**. The only difference is the semantic verdict standing at the time.

| | Transaction | Result |
|---|---|---|
| No independent determination in force | [`0x2da577ba…e1386719`](https://explorer-studio.genlayer.com/tx/0x2da577ba8af641989bd743984573efd78cf3e55ee6890651686cd12ae1386719) | **refused** — *No independent determination clause is in force*, escrow untouched |
| After an independent clause was countersigned | [`0x07d6c590…4f3aa391`](https://explorer-studio.genlayer.com/tx/0x07d6c590cbb9b6098d7130a5f76e48d59344f599ab0f0fad17a2bc084f3aa391) | **0.01 GEN paid**, status `RELEASED` |

A clause giving the vendor sole discretion was classified `SELF_JUDGING_AUTHORITY`
and froze the escrow; a clause naming a jointly-selected third party was classified
`INDEPENDENT_DETERMINATION` and, once countersigned, released it. Thirteen
transactions across two money paths and three wallets — including every refusal —
are listed with their hashes in `TESTING.md` §D, and screenshotted in
`docs/evidence/`.

## Verification

```bash
npm install
npm run verify          # hash parity, no build artifacts, full checksum manifest
npm run lint:genvm      # GenVM linter, AST-only, offline
npm run test:direct     # 34 checks on a pinned GenVM build
npm run test:mutations  # 21 mutants, all must be caught
npm run build
```

`npm run check` runs all of them in order. `TESTING.md` describes what each check
proves and how to reproduce the on-chain evidence.

The three contract checks need Python 3.12+ and the pinned tools:

```bash
pip install -r requirements.txt
```

`scripts/py.mjs` finds the interpreter for you — `py -3` on Windows, `python3`
elsewhere — so the same npm scripts work on either platform. Without Python, the
JavaScript half still runs on its own:

```bash
npm run check:js        # verify + build
```

## Frontend safety properties

- Transaction forms start empty; placeholders are prefixed `e.g.` so a hint can
  never be mistaken for a filled value.
- Every write is followed by an action-specific finalized-state postcondition. A
  finalized transaction is never reported as success on its own.
- **Only finalized state decides whether a write succeeded.** The app never reads
  a receipt field to make that call: it re-reads the agreement and requires the
  specific change the action promises, compared against the state before the
  transaction, so a no-op cannot be reported as a success. The receipt is
  consulted afterwards, and only to recover the contract's own wording, by
  matching against the fixed list of sentences `AuthoritySplit.py` can raise. A
  message the contract cannot emit can therefore never be shown as its answer.
- Network selection uses `wallet_switchEthereumChain` / `wallet_addEthereumChain`.
  It never calls `wallet_getSnaps`, which a non-Flask MetaMask rejects.
- Escrow amounts are handled as `bigint` wei end to end; no float ever touches a
  balance.
- **The interface never enforces a contract rule.** A button is disabled only when
  the page cannot build the call at all. Where a rule would refuse the call, the
  app predicts the refusal in plain words and still sends it, so the gate a
  reviewer sees is the chain's answer rather than this app's opinion. Every rule
  in `LOCKED_SPEC.md` is reachable from the interface.

## Local development

Requirements: Node.js 18+, npm, Python 3.12+.

```bash
npm install
npm run dev
```

A browser wallet on StudioNet is required for writes. To point the app at a
different deployment:

```bash
VITE_CONTRACT_ADDRESS=0x... npm run dev
```

## Repository structure

```text
contracts/AuthoritySplit.py    the Intelligent Contract
tests/direct/conftest.py         pinned GenVM version and shared fixtures
tests/direct/test_escrow_consequence.py   the money path and the party gates
tests/direct/test_semantic_guards.py      the semantic layer and its bounds
scripts/mutation_matrix.py       21 mutants; the suite must catch every one
scripts/verify.mjs               hash parity, artifact and manifest gate
scripts/checksums.mjs            regenerates FINAL_CHECKSUMS.txt
scripts/py.mjs                   cross-platform Python 3.12+ launcher
src/App.tsx                      application screens and postcondition checks
src/genlayer.ts                  StudioNet reads/writes and execution decoding
src/config.ts                    deployed address and pinned source hash
LOCKED_SPEC.md                   the frozen behavioural specification
TESTING.md                       what each check proves, and how to re-run it
docs/evidence/                   screenshots of the live run, indexed to tx hashes
FINAL_CHECKSUMS.txt              SHA-256 of every tracked file
```

## Branding

Project name and contract name are the same: `AuthoritySplit`.
Logo assets: `public/logo.svg`, `public/AuthoritySplit-logo-512.png`.
