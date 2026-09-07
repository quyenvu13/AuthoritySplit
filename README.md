# AuthoritySplit

<p align="center"><img src="public/AuthoritySplit-logo-512.png" alt="AuthoritySplit logo" width="180" /></p>

AuthoritySplit is a GenLayer application powered by the frozen `SelfJudgingGuard` Intelligent Contract. It enforces one narrow governance rule:

> The party responsible for a duty should not have unilateral decisive control over the final determination of whether that same duty was satisfied, triggered, breached, or complied with.

The semantic validator answers only that authority-separation question. The contract applies the consequence deterministically.

## Project deployment

Frontend target / clean project deployment:

`0xA614c22Ea5bF0bAc17338a9539514fa6d2b050Ef`

Explorer:

`https://explorer-studio.genlayer.com/address/0xA614c22Ea5bF0bAc17338a9539514fa6d2b050Ef`

Frozen contract source SHA256:

`ce722d4e1708b900ceff3fa8d3ff2233a12f2e3315911dda88e0ccc65c9b2139`

Contract version: `1.2`

## Separate runtime-evidence deployment

The load-bearing runtime checks were performed on a separate StudioNet deployment so the project address could remain clean:

`0xD7E04011737411f02315D1864956Ec739049ccf1`

Explorer:

`https://explorer-studio.genlayer.com/address/0xD7E04011737411f02315D1864956Ec739049ccf1`

See `TESTING.md` for the recorded runtime behavior.

## Product flow

1. **Create workspace** — the caller becomes the immutable workspace authority and records a responsible-party label plus duty.
2. **Propose determination** — only that authority can propose the clause that controls the final compliance determination.
3. **Semantic classification** — validators return exactly `INDEPENDENT_DETERMINATION` or `SELF_JUDGING_AUTHORITY`.
4. **Deterministic consequence** — independent clauses are versioned and activated; self-judging clauses are blocked.
5. **Audit trail** — attempts record verdict, consequence, and whether the workspace-scoped semantic cache was reused.

## Honest scope

AuthoritySplit does **not** decide whether the underlying duty was actually performed. It does not determine damages, remedies, legal liability, commercial reasonableness, or external-world truth.

The semantic question is only whether the responsible party has unilateral decisive control over the final compliance determination.

## Frontend safety properties

- Transaction forms are empty by default.
- Runtime evidence is never prefilled into write forms.
- Reads used for postconditions request finalized state.
- The UI does not treat `FINALIZED` alone as execution success.
- After a write, the UI verifies an action-specific finalized-state postcondition before displaying success.
- Once a transaction ID exists, the UI tracks that ID instead of blindly retrying the write.
- The project address and runtime-evidence address are displayed separately.
- The frontend checks the live `SelfJudgingGuard` contract profile (version `1.2`, semantic cap `8`) before showing source-profile parity.

## Local development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run verify
npm run dev
```

Build:

```bash
npm run build
```

The frontend uses `genlayer-js` and StudioNet. A browser wallet is required for writes.

## Optional contract override

The production project address is checked into `src/config.ts`. For an intentional alternate deployment, set:

```bash
VITE_CONTRACT_ADDRESS=0x...
```

Do not use an alternate address as submission evidence unless its exact deployed source and state have been verified independently.

## Contract methods surfaced by the UI

Writes:

- `create_workspace(responsible_party_label, duty_text)`
- `propose_determination(workspace_id, candidate_clause)`

Reads:

- `get_config()`
- `get_workspace(workspace_id)`
- `get_determination(determination_id)`
- `get_attempt(workspace_id, attempt_id)`
- `get_attempts(workspace_id, from_id, count)`

## Branding

Project/product name: `AuthoritySplit`

Frozen Intelligent Contract name: `SelfJudgingGuard`

Logo assets:

- `public/logo.svg`
- `public/AuthoritySplit-logo-512.png`

## Repository structure

```text
contracts/SelfJudgingGuard.py   frozen Intelligent Contract source
src/App.tsx                     application screens and postcondition checks
src/genlayer.ts                 StudioNet reads/writes and execution checks
src/config.ts                   deployed addresses and frozen source hash
src/styles.css                  responsive visual system
scripts/verify.mjs              source/config/package integrity checks
TESTING.md                      runtime and frontend verification guide
```
