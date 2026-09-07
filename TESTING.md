# AuthoritySplit — Testing

Project/product: `AuthoritySplit`  
Frozen Intelligent Contract: `SelfJudgingGuard`

## Frozen source

Contract file:

`contracts/SelfJudgingGuard.py`

Expected SHA256:

`ce722d4e1708b900ceff3fa8d3ff2233a12f2e3315911dda88e0ccc65c9b2139`

Run:

```bash
npm run verify
```

The verifier also checks that the frontend project address, runtime-evidence address, and expected contract version remain pinned.

## Deployment split

Clean project address:

`0xA614c22Ea5bF0bAc17338a9539514fa6d2b050Ef`

Runtime-evidence address:

`0xD7E04011737411f02315D1864956Ec739049ccf1`

The project UI must target the clean project address. Runtime evidence is informational only and must never prefill transaction forms.

## Exact R3 runtime evidence

The runtime-evidence deployment matched the frozen source profile before behavior testing:

- name: `SelfJudgingGuard`
- version: `1.2`
- initial workspace count: `0`
- initial determination count: `0`
- max semantic evaluations per workspace: `8`
- max attempts per workspace: `100`
- max determination versions: `20`
- no contract clock dependency
- no global administrator

### Self-judging authority — PASS

A fresh workspace recorded a Data Processor duty. The clause giving the Data Processor unilateral final compliance authority was classified as:

`SELF_JUDGING_AUTHORITY`

Observed durable consequence:

- attempt stored
- `accepted = false`
- no determination created
- self-judging block counter increased
- fresh semantic evaluation counter increased once

### Independent authority — PASS

A clause assigning the final determination to an independent third-party auditor jointly appointed by both parties was classified as:

`INDEPENDENT_DETERMINATION`

Observed durable consequence:

- attempt stored
- `accepted = true`
- a determination version was created
- that determination became active

### Same-workspace reroll prevention — PASS

The exact previously blocked self-judging clause was submitted again in the same workspace.

Observed:

- same verdict
- `used_cache = true`
- attempt counter increased
- semantic evaluation counter did **not** increase
- active independent determination remained unchanged

### Cross-workspace cache isolation — PASS

A second workspace used the same responsible-party label, duty, and self-judging candidate.

Observed on its first attempt:

- `SELF_JUDGING_AUTHORITY`
- `used_cache = false`
- semantic evaluation counter increased in the second workspace

This demonstrates that another workspace does not inherit the first workspace's cached verdict.

### Authority boundary and rollback — PASS

A different wallet attempted to call `propose_determination` on Workspace #2.

Observed contract execution:

`Only the workspace authority may propose a determination clause`

The call ended in contract-level error/rollback, and the finalized workspace state remained unchanged.

## Frontend verification

### 1. Fresh load

Expected:

- live `get_config()` is fetched from finalized state
- header targets `0xA614...50Ef`
- source-profile indicator becomes matched only when the live name/version/semantic cap match the frozen profile
- no write form contains prefilled runtime data

### 2. Create workspace

1. Connect a browser wallet.
2. Open **Create workspace**.
3. Enter a responsible-party label and duty.
4. Submit once.

Expected UI behavior:

- transaction ID is displayed immediately after submission
- the app waits for finalization
- execution result must be proven successful
- finalized `workspace_count` must increase by exactly one
- the new workspace authority, label, and duty must equal the submitted values
- only then does the UI report the workspace as verified

### 3. Propose a clause

1. Open a workspace.
2. Connect its authority wallet.
3. Open **Propose clause**.
4. Enter a new determination clause and submit once.

Expected UI behavior:

- non-authority wallet gets read-only UI gating
- submitted transaction is tracked by hash
- `FINALIZED` alone is not displayed as success
- execution result must be successful
- finalized attempt count must increase by exactly one
- the new attempt is read from contract state
- independent verdict must bind to an active determination
- self-judging verdict must remain unaccepted and increase the block counter

### 4. Audit log

Open **Attempt log** after loading a workspace.

Expected:

- attempts are read from finalized state
- verdict, consequence, and cache status are displayed separately
- cache hits are never presented as fresh semantic evaluations

### 5. Wrong authority

Connect a wallet that is not the loaded workspace authority.

Expected:

- proposal submit button is disabled
- the UI labels the connected role as read only
- direct contract rejection remains the final authority if a caller bypasses the interface

## Vercel smoke test

After deployment:

1. Load the production URL on desktop and mobile widths.
2. Confirm `get_config()` loads.
3. Confirm project explorer link targets the clean project address.
4. Connect a wallet and verify StudioNet switching works.
5. Create a fresh workspace.
6. Reload the page and reopen that workspace ID.
7. Submit one clause and verify the finalized postcondition.
8. Confirm console has no repeated polling loop or unhandled wallet errors.

Do not modify the frozen contract source to fix a frontend-only issue.
