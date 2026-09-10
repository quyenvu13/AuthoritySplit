# LOCKED_SPEC — AuthoritySplit v2.0

Frozen behavioural specification for `contracts/AuthoritySplit.py`.

```
SHA-256  d1ff73c8a650f8932a50046fb03c17aa0acedf9d40890091002d47bea4a860f6
version  2.0            (get_config().version)
lines    1006
```

Every statement below is asserted by a test in `tests/direct/`, and every
statement that describes a *guard* is additionally covered by a mutant in
`scripts/mutation_matrix.py` that removes it. Nothing here is aspirational.

---

## 1. Parties

- An agreement has exactly two authenticated parties: the **obligee** (pays) and
  the **responsible party** (owes the duty). Both are addresses.
- `create_agreement` refuses `responsible_party == obligee`. One wallet cannot
  hold both roles. *(M01)*
- There is no deployer privilege, no owner, and no global admin. `__init__` sets
  two counters and nothing else. `get_config().global_admin` is `null`.
- Neither party can be changed after creation.

## 2. The duty

- `duty_text` is frozen at creation. No write path modifies it.
- It is the semantic context for every determination clause proposed in that
  agreement, and it is the reason a verdict cached in one agreement is worthless
  in another (§6).

## 3. Acceptance

- A new agreement is `AWAITING_ACCEPTANCE`.
- Only the named responsible party may call `accept_duty`. *(M03)*
- `accept_duty` moves the agreement to `ACTIVE` and is the second signature: two
  distinct wallets are now bound to the same immutable duty text.
- No determination may be proposed before that. *(M02)*

## 4. The semantic question

Exactly one question is put to validators, about exactly one string:

> Does the CANDIDATE_CLAUSE give the RESPONSIBLE_PARTY itself, or a person, body,
> system, record source, or process that the RESPONSIBLE_PARTY can control
> unilaterally, decisive power over the final determination of whether that same
> RESPONSIBLE_PARTY satisfied, triggered, breached, or complied with the duty?

- The answer space is exactly two tokens: `INDEPENDENT_DETERMINATION`,
  `SELF_JUDGING_AUTHORITY`.
- The response must be a JSON object with exactly one key, `verdict`, whose value
  is one of those two tokens. Anything else — extra keys, wrong key, wrong type,
  non-JSON, an array — raises and **writes nothing**: no attempt, no budget spent,
  no counter moved, no escrow touched. *(M14)*
- The model never sees a wallet address. It is shown the fixed role name
  `"The responsible party"`.
- The model never sees an amount, a deadline, a status, or any other party's
  identity.
- Ambiguity resolves to `SELF_JUDGING_AUTHORITY`. The prompt states this
  explicitly, so the failure direction is *refuse to pay*, never *pay wrongly*.

### What the semantic layer is not asked

Whether the duty was performed; whether the duty is fair or lawful; damages;
remedies; who should win a dispute; any external fact not written in the clause.

## 5. Prompt fence

- The model-facing copy of every user string has `<` and `>` replaced by spaces,
  so user text cannot manufacture or close the prompt's structural tags. *(M20)*
- The two verdict labels and their cheap separator variants are stripped
  case-insensitively from the model-facing copy, so user text cannot smuggle the
  expected answer in as evidence.
- **Stored text is never altered.** `get_attempt().candidate_clause` returns the
  submitted bytes exactly.
- This is hardening, not a proof of injection resistance. Validator reruns provide
  convergence discipline; the fence removes the cheapest attacks.

## 6. Budget, cache and reroll resistance

- `MAX_SEMANTIC_EVALS_PER_AGREEMENT = 8`. Only a *completed fresh classification*
  consumes budget: malformed output, provider failure and non-convergence all
  abort before the increment. *(M16)*
- A verdict is cached under a key derived from the agreement id, the role label,
  the duty text and the candidate clause. An exact resubmission returns the cached
  verdict, spends no budget, and is recorded with `used_cache = true`. A party
  therefore cannot reroll a `SELF_JUDGING_AUTHORITY` answer by retrying.
- The cache key includes the agreement id, so the same clause in a different
  agreement is classified fresh. A verdict never crosses agreements. *(M15)*
- Once the budget is exhausted, a *new* clause is refused; a *cached* clause still
  resolves. The bound closes rerolling without bricking the agreement.
- `MAX_ATTEMPTS_PER_AGREEMENT = 100`, `MAX_DETERMINATION_VERSIONS = 20`,
  `MAX_TEXT_LENGTH = 4000`. Every stored collection is bounded.

## 7. Proposal and the consequence of the verdict

- Only the obligee or the responsible party may call `propose_determination`.
  An outsider is refused before any model call. *(M06)*
- The agreement must be `ACTIVE`. *(M02)*

`SELF_JUDGING_AUTHORITY`:

- increments `self_judging_blocks`;
- stores the attempt with `accepted = false` and `resulting_determination_id = 0`;
- leaves **no pending clause**;
- creates no determination, and does not touch the escrow. *(M07)*

`INDEPENDENT_DETERMINATION`:

- stores the attempt with `accepted = true`;
- places the clause in `pending`, waiting for a signature;
- **does not activate anything.** `active_determination_id` is unchanged.

## 8. Countersignature

- Only a party may countersign. *(M05)*
- The proposer may not countersign its own clause. *(M04)* Consensus plus one
  signature is never enough; the clause needs the other side.
- Countersigning creates a `DeterminationRecord` with a new version number,
  points `active_determination_id` at it, back-fills the originating attempt's
  `resulting_determination_id`, and clears the pending slot.
- **Mutual consent is not a bypass.** A clause classified `SELF_JUDGING_AUTHORITY`
  never enters `pending`, so there is nothing for either party to sign. The
  responsible party cannot obtain the right to judge itself by persuading its
  counterparty to agree. This is the non-bypassable property of the design.
- A candidate identical to the clause currently in force is refused
  deterministically, before any model call. *(M19)*
- A later independent clause replaces the pending slot; only a countersignature
  moves the active determination.

## 9. Escrow — the consequence that leaves the registry

- `create_agreement` is payable and refuses zero. *(M13)* An agreement without
  money at stake cannot exist.
- `release_escrow`:
  - obligee only *(M09)*;
  - status must be `ACTIVE` *(M17)*;
  - **refused unless `active_determination_id > 0`** *(M08)*;
  - sets `escrow_wei = 0` and `status = RELEASED` **before** emitting the
    transfer, then pays the responsible party.
- `refund_escrow`:
  - obligee only *(M12)*;
  - status must be `AWAITING_ACCEPTANCE` or `ACTIVE` *(M18)*;
  - **refused once `active_determination_id > 0`** *(M10)* — the escape hatch
    cannot escape the consequence;
  - refused before `refund_deadline_unix` *(M11)*;
  - sets `escrow_wei = 0` and `status = REFUNDED` before emitting the transfer.
- `RELEASED` and `REFUNDED` are terminal.

The sentence this produces: **funds cannot move until an independent
determination authority exists and both parties have signed it, and a self-judging
clause freezes the escrow.**

## 10. Clock

- Deadlines use `gl.message_raw["datetime"]` — the consensus clock — converted to
  a Unix timestamp by pure integer arithmetic. No host clock, no calendar library,
  no `time.time()`.
- A malformed datetime raises rather than defaulting.
- `refund_window_seconds` must be an integer in `[900, 31536000]` — fifteen
  minutes to one year, inclusive at both ends. *(M21)* Booleans are rejected
  explicitly, since `bool` is a subclass of `int` in Python.

## 11. Known limits, stated deliberately

1. **Text, not the world.** A clause naming an "independent auditor" that the
   responsible party secretly controls is classified from what the clause says.
   The contract cannot observe the off-chain relationship.
2. **No performance oracle.** Releasing escrow is the obligee's decision. The
   contract guarantees only that the decision rule is not controlled by the party
   being judged. It never asserts the duty was met.
3. **Refund asymmetry.** Once an independent determination is in force the obligee
   is bound to it and can no longer reclaim the escrow, even if the responsible
   party never performs. That is deliberate — a withdrawable escrow would make the
   determination meaningless — but it means the obligee's exit closes at
   countersignature, not at performance.
4. **Budget exhaustion is terminal for new clauses.** After eight fresh
   classifications, an agreement that never reached an independent determination
   can only be refunded, once the window elapses.
5. **Native transfers are not locally assertable.** `emit_transfer` on a
   `@gl.evm.contract_interface` is not captured by Direct Mode's wasi mock. The
   tests assert every piece of state that leads to a transfer — the gate, the
   recipient selection, `escrow_wei` reaching zero, the terminal status — and the
   transfer itself is evidenced on chain. `TESTING.md` says which is which.

## 12. Frozen surface

Writes: `create_agreement`, `accept_duty`, `propose_determination`,
`countersign_determination`, `release_escrow`, `refund_escrow`.

Views: `get_config`, `get_agreement`, `get_determination`, `get_attempt`,
`get_attempts`. All return JSON strings with sorted keys.

Any change to this surface, to a bound in §6, or to a guard in §1/§3/§8/§9 is a
new version and a new hash.
