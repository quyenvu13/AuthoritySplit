# TESTING

Everything in this file is re-runnable from a clean checkout. Where a claim
cannot be proven locally, it says so and says why.

```bash
pip install -r requirements.txt      # Python 3.12+
npm install

npm run verify          # integrity: hash parity, no build artifacts, full manifest
npm run lint:genvm      # GenVM linter (AST only, offline)
npm run test:direct     # 34 checks on a pinned GenVM build
npm run test:mutations  # 21 mutants; the suite must catch every one
npm run build           # TypeScript + Vite

npm run check           # all of the above, in order
npm run check:js        # only the checks that need no Python (verify + build)
```

`lint:genvm`, `test:direct` and `test:mutations` go through `scripts/py.mjs`,
which picks the first interpreter reporting Python 3.12 or newer — `py -3` on
Windows, `python3` elsewhere — so no script needs editing to run on either
platform. If no such interpreter exists it says so and points at
`npm run check:js`, rather than failing with "python3 is not recognized".

`lint` is AST-only and works offline. `genvm_linter.cli check` additionally
resolves the SDK over the network and will fail in a sandbox without egress —
that is an environment result, not a contract result, which is why `check` is not
what the scripts run.

---

## A. Integrity — `npm run verify`

Nothing is pinned twice. The script computes the SHA-256 of
`contracts/AuthoritySplit.py` and then requires everything that claims to know
it to agree:

1. `src/config.ts` declares that exact hash.
2. `src/config.ts`'s `EXPECTED_CONTRACT_VERSION` equals `CONTRACT_VERSION` in the
   contract source.
3. `src/config.ts`'s `EXPECTED_SEMANTIC_BUDGET` equals
   `MAX_SEMANTIC_EVALS_PER_AGREEMENT` in the contract source.
4. No `dist/`, `node_modules/`, `__pycache__/`, `.pytest_cache/` or `artifacts/`
   is committed.
5. No tracked text file contains an absolute developer path.
6. `FINAL_CHECKSUMS.txt` covers **every** tracked file and every hash matches —
   nothing extra, nothing missing.

So editing the contract without updating the frontend, or shipping a manifest that
does not describe the repository, fails the gate rather than passing silently.

Regenerate the manifest after any change: `npm run checksums`.

## B. Direct Mode — 34 checks on real GenVM

`tests/direct/conftest.py` pins `GENVM_VERSION = "v0.2.12"` and passes it to every
`direct_deploy`, so a clean machine executes the same runtime the contract was
verified against instead of resolving "latest".

### `test_escrow_consequence.py` — 21 checks

| Test | What it proves |
|---|---|
| `test_the_two_parties_must_be_distinct_addresses` | One wallet cannot hold both roles. |
| `test_escrow_is_required_at_creation` | An agreement with nothing at stake cannot exist. |
| `test_the_refund_window_must_sit_inside_its_bound` (×4) | 899 s, 0, a negative window and one second over a year are each refused, and no agreement is created. |
| `test_both_ends_of_the_refund_window_bound_are_accepted` (×2) | The bound is inclusive: 15 minutes and one year both work. |
| `test_nothing_can_be_proposed_before_the_duty_is_accepted` | The semantic layer is unreachable until both parties have signed. |
| `test_only_the_named_responsible_party_may_accept` | Acceptance is the second signature, not a public button. |
| `test_an_independent_verdict_only_reaches_pending` | Consensus queues a clause; it does not activate one. |
| `test_the_proposer_cannot_countersign_its_own_clause` | Consensus plus one signature is never enough. |
| `test_an_outsider_cannot_countersign` | Only the two parties can bind the agreement. |
| `test_countersigning_puts_the_clause_in_force` | The full activation path, including the back-filled attempt record. |
| `test_mutual_consent_cannot_activate_a_self_judging_clause` | **The non-bypassable property.** A blocked clause never enters `pending`, so there is nothing for either party to sign. |
| `test_escrow_cannot_be_released_without_an_independent_determination` | The gate. `release_escrow` reverts and the escrow is untouched. |
| `test_release_works_once_the_clause_is_in_force` | The same call succeeds after countersignature; `escrow_wei` reaches `0`, status `RELEASED`. |
| `test_only_the_obligee_may_release` | The responsible party cannot pay itself. |
| `test_refund_needs_the_deadline_and_is_obligee_only` | Both refund guards, including the consensus clock. |
| `test_the_refund_cannot_escape_an_active_determination` | The escape hatch cannot escape the consequence. |
| `test_refund_is_available_while_the_duty_was_never_accepted` | An unaccepted agreement is not a trap. |

### `test_semantic_guards.py` — 13 checks

| Test | What it proves |
|---|---|
| `test_malformed_consensus_output_writes_nothing` (×6) | Six malformed shapes — unknown verdict, extra key, wrong type, wrong key, non-JSON, array. Each raises and leaves attempt count, budget, block count, pending slot and escrow all unchanged. |
| `test_an_exact_resubmission_reuses_the_verdict_without_spending_budget` | Reroll resistance: retrying a blocked clause returns the cached verdict. |
| `test_the_budget_is_bounded_and_cached_candidates_still_resolve` | The bound closes rerolling without bricking the agreement. |
| `test_a_verdict_never_crosses_between_agreements` | The cache key includes the agreement id. |
| `test_clause_text_cannot_forge_the_prompt_fence_or_dictate_a_verdict` | See below. |
| `test_the_fence_detectors_can_actually_fire` | The control for the test above. |
| `test_a_clause_identical_to_the_one_in_force_is_refused_deterministically` | Refused before any model call, whitespace-insensitively. |
| `test_either_party_may_propose_but_an_outsider_may_not` | The proposal gate. |

### The fence test, and why it is written that way

A prompt-fence test is easy to write so that it passes for the wrong reason: arm
one broad mock, submit hostile text, assert the expected verdict — and the
assertion holds whether or not the fence did anything, because the same mock
answers either prompt.

This suite instead registers two **detector** mocks *before* the ordinary one.
Their patterns (`</CANDIDATE_CLAUSE>\s*SYSTEM` and `<DUTY>\s+anything at all`)
appear nowhere in the contract's own template and can only match a prompt in which
the attacker's structural tags survived verbatim. The first registered match wins,
so if the fence ever stops neutralising angle brackets a detector fires and returns
`INDEPENDENT_DETERMINATION` — the verdict the injected text demanded — and the
assertion fails.

`test_the_fence_detectors_can_actually_fire` is the control: it renders the same
clause both ways and shows the patterns match the un-neutralised rendering and not
the fenced one, so a passing fence test cannot be explained by detectors that could
never match anything. Mutant **M20** removes the bracket neutralisation and the
suite catches it.

## C. Mutation matrix — `npm run test:mutations`

A green suite proves nothing until it is shown to fail when the contract is wrong.
`scripts/mutation_matrix.py` writes twenty-one broken copies of the contract to a
temporary directory — the real source is never modified — and runs the whole suite
against each one through `AUTHORITYSPLIT_CONTRACT`.

```
baseline            PASS
M01  killed    the obligee may name itself as responsible party
M02  killed    a duty may be judged before it is accepted
M03  killed    anyone may accept the duty
M04  killed    the proposer may countersign its own clause
M05  killed    an outsider may countersign
M06  killed    an outsider may propose
M07  killed    a self-judging clause still reaches the signature stage
M08  killed    escrow releases without an independent determination
M09  killed    anyone may release the escrow
M10  killed    the refund escapes an active determination
M11  killed    the refund ignores its deadline
M12  killed    anyone may reclaim the escrow
M13  killed    an agreement may be created with no escrow
M14  killed    malformed consensus output becomes a verdict
M15  killed    the verdict cache is shared across agreements
M16  killed    the semantic budget is removed
M17  killed    a released agreement can be released again
M18  killed    a settled agreement can still be refunded
M19  killed    an identical clause may replace the one in force
M20  killed    the prompt fence stops neutralising angle brackets
M21  killed    the refund window may sit outside its bound

21/21 killed, 0 survived, 0 invalid
```

Every mutant maps to a numbered clause in `LOCKED_SPEC.md`. The script exits
non-zero if any mutant survives *or* if any mutant's anchor stops matching the
source exactly once — a pattern that silently matches nothing would otherwise
count as a free kill.

## D. What is proven on chain, not locally

`release_escrow` and `refund_escrow` end in
`_Payee(recipient).emit_transfer(value=...)` on a `@gl.evm.contract_interface`.
Direct Mode's wasi mock does not capture that outgoing message, so the native
transfer itself cannot be asserted in a local test. This is a real limitation and
it is stated rather than papered over.

Everything up to the transfer *is* asserted locally, and that is where the
primitive lives:

- the gate (`active_determination_id > 0` for release, `== 0` for refund);
- the caller check;
- the status check;
- the deadline check against the consensus clock;
- the recipient selection;
- `escrow_wei` reaching exactly `0`;
- the terminal status (`RELEASED` / `REFUNDED`);
- state written *before* the transfer is emitted, in both paths.

The transfer is evidenced on chain instead. Both money paths were executed on
StudioNet against the deployed contract
[`0x7906B2F82C7c217f9321789CB53fb293a02e3B38`](https://explorer-studio.genlayer.com/address/0x7906B2F82C7c217f9321789CB53fb293a02e3B38)
from three independent MetaMask wallets:

| Role | Address |
|---|---|
| **A** — obligee | `0x923a09d0D6e5C242e36C3c1D2071835917cC0bDF` |
| **B** — responsible party | `0x188f15bC55302ff2d55f0107300499aed23a831E` |
| **C** — outsider, party to nothing | `0x3b097922A159B8D81197F0b0d19ef3f29D2B3c8b` |

Every transaction below was sent from the application interface and resolved on
chain. Rows marked **refused** are the point of the exercise: the interface
predicted the refusal, sent the transaction anyway, and the contract rejected it.

### Agreement #2 — the release path (0.01 GEN)

| # | Action | From | Outcome | Transaction |
|---|---|---|---|---|
| 1 | `create_agreement` — B named, 0.01 GEN escrowed | A | `AWAITING_ACCEPTANCE` | [`0x2e204dcb…a81f0e6b`](https://explorer-studio.genlayer.com/tx/0x2e204dcb5621faa3fdcb84a39726c1f8dadf09848614fd3560a7a48da81f0e6b) |
| 2 | `accept_duty` | **A** | **refused** — *Only the named responsible party may accept the duty* | [`0x5179453f…3a267619`](https://explorer-studio.genlayer.com/tx/0x5179453f254af2f2f19199a8d71fdc59e26723bfa0c3d27539976e1b3a267619) |
| 3 | `accept_duty` | B | `ACTIVE` — two wallets bound to one duty text | [`0x7507c0e8…65361ed9`](https://explorer-studio.genlayer.com/tx/0x7507c0e8d192bc99b2bd3360c484bb90293a87c1b74144b9f61987cf65361ed9) |
| 4 | `propose_determination` | **C** | **refused** — *Only a party to this agreement may propose*; attempt count and semantic budget both unchanged | [`0xcff331c3…fff883fd`](https://explorer-studio.genlayer.com/tx/0xcff331c392ba5f230aa039d707f5fb88d9da671e8b95af22528d2abdfff883fd) |
| 5 | `propose_determination` — *"determined by the vendor in its sole discretion"* | A | `SELF_JUDGING_AUTHORITY` · blocked · no clause stored | [`0xa7bdcd3b…627d605f`](https://explorer-studio.genlayer.com/tx/0xa7bdcd3b616a7e234548e65593a135776de4514b3da6ce288a87d4f2627d605f) |
| 6 | `release_escrow` | A | **refused** — *No independent determination clause is in force*; escrow still 0.01 GEN | [`0x2da577ba…e1386719`](https://explorer-studio.genlayer.com/tx/0x2da577ba8af641989bd743984573efd78cf3e55ee6890651686cd12ae1386719) |
| 7 | `propose_determination` — *"determined by a third-party monitoring service jointly selected by both parties"* | A | `INDEPENDENT_DETERMINATION` · **pending only**, `active_determination_id` still `0` | [`0x69664faf…f0d16a1e`](https://explorer-studio.genlayer.com/tx/0x69664fafc5395c70004a6330931c467ade892b93fc9b0ded75cdd128f0d16a1e) |
| 8 | `countersign_determination` | **A** | **refused** — *The proposing party cannot countersign its own clause* | [`0xda5b95ae…de7117d5`](https://explorer-studio.genlayer.com/tx/0xda5b95ae2764928db0110c56f6e744788bccfe83ddcb62c7e2a3c1aade7117d5) |
| 9 | `countersign_determination` | B | Determination #1 (v1) **in force** | [`0xb8538def…aaace129`](https://explorer-studio.genlayer.com/tx/0xb8538defbed9ac4c1a452659c1a5abe26c957a2ada01efb4494af604aaace129) |
| 10 | `refund_escrow` | A | **refused** — *An independent determination clause is already in force* | [`0xaec8abb0…b06b05b8`](https://explorer-studio.genlayer.com/tx/0xaec8abb088b2acd4ab24e37c68a18aa56a213a90354fee659380fd6fb06b05b8) |
| 11 | `release_escrow` | A | `RELEASED` · `escrow_wei` `0` · **0.01 GEN paid to B** | [`0x07d6c590…4f3aa391`](https://explorer-studio.genlayer.com/tx/0x07d6c590cbb9b6098d7130a5f76e48d59344f599ab0f0fad17a2bc084f3aa391) |

Wallet B held `100.00 GEN` before step 11 and `100.01 GEN` after it. That balance
change is the transfer the local suite cannot observe.

Rows 6 and 11 are the same call, from the same wallet, on the same agreement. The
only thing that changed between them is the semantic verdict on a sentence, and it
is what decided whether the money moved.

### Agreement #1 — the refund path (0.005 GEN, 30-minute window)

| # | Action | From | Outcome | Transaction |
|---|---|---|---|---|
| 1 | `refund_escrow`, before the window elapsed | A | **refused** — *Refund deadline has not passed* (consensus clock, not the browser's) | [`0xbd2328b0…70191a41`](https://explorer-studio.genlayer.com/tx/0xbd2328b0e370466458f028467e9015f326d96de9c9607e3c24d51ba170191a41) |
| 2 | `refund_escrow`, after the window elapsed | A | `REFUNDED` · `escrow_wei` `0` · escrow returned to A | [`0xdfcac68d…8d8338b8`](https://explorer-studio.genlayer.com/tx/0xdfcac68dce01eb21ccf46a90e9ca6db22ba692c75ce5732411c292758d8338b8) |

Agreement #1 reached one `SELF_JUDGING_AUTHORITY` verdict and never obtained an
independent determination, which is exactly the state in which the refund path is
open and the release path is closed.

### Rows deliberately left out

`create_agreement` and `accept_duty` for Agreement #1, and its self-judging
proposal, were executed — the finalized state shows `ACTIVE → REFUNDED`,
`attempts 1`, `blocked self-judging 1` — but their transaction hashes were not
recorded at the time. They are omitted rather than reconstructed. Every hash in
the tables above was copied from the transaction it names.

## E. Frontend

`npm run build` runs `tsc -b` before Vite, so a type error fails the build.

The behaviours worth checking by hand, because a build cannot check them:

1. **Every form starts empty.** Placeholders are prefixed `e.g.` so a hint is
   never mistaken for a value.
2. **A finalized transaction is not reported as success.** Each write re-reads
   finalized state and asserts an action-specific postcondition before the banner
   turns green.
3. **The finalized postcondition, not the receipt, decides success.** Each write
   compares the agreement before and after and requires the exact change that
   action promises — `agreement_count + 1`, `attempt_count + 1`,
   `active_determination_id` strictly greater, `status` moving *into*
   `RELEASED`/`REFUNDED`. A transaction that changed nothing is reported as
   refused; a transaction that made the change is reported as successful, whatever
   the receipt looks like. The receipt is scanned only after a postcondition has
   failed, and only for the fixed list of sentences the contract can raise, so a
   guessed field name cannot turn a successful write into a reported refusal.
   Every finalized receipt is also logged to the browser console under
   `[AuthoritySplit] finalized` so a reviewer can inspect the raw shape.
4. **No Snap call.** Network selection uses `wallet_switchEthereumChain` with an
   `wallet_addEthereumChain` fallback. `wallet_getSnaps` is never called, so a
   standard MetaMask does not reject the write with
   "method doesn't have corresponding handler".
5. **Escrow arithmetic is `bigint` throughout.** `genToWei` rejects anything that
   is not a plain decimal amount and never routes a balance through a float.
6. **The interface never enforces a contract rule.** A button is disabled only
   when the page cannot build the call — no wallet, no agreement loaded, no clause
   typed. Where a rule would refuse, the app says so in plain words and still
   sends the transaction, and the banner then shows the contract's own message.
   That is how the refusal screenshots in §D were produced: from the interface,
   not from a console.
