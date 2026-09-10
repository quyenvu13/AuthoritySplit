# Runtime evidence

Screenshots of the live application driving the deployed contract
[`0x7906B2F82C7c217f9321789CB53fb293a02e3B38`](https://explorer-studio.genlayer.com/address/0x7906B2F82C7c217f9321789CB53fb293a02e3B38)
on GenLayer StudioNet, from three independent MetaMask wallets.

Every transaction hash referenced here is listed in `TESTING.md` §D and resolves
on the explorer. The screenshots are a convenience for reading the run in order;
the hashes are the evidence.

| Wallet | Role |
|---|---|
| `0x923a09d0…7cC0bDF` | **A** — obligee, funds and releases or reclaims the escrow |
| `0x188f15bC…23a831E` | **B** — responsible party, accepts the duty and receives the escrow |
| `0x3b097922…9D2B3c8b` | **C** — outsider, party to nothing |

Each shot keeps the contract address in the top bar and the green
*"Live source profile matched"* chip in the sidebar, so the page can be checked
against this repository's pinned source hash.

---

## The interface never enforces a contract rule

`00-consequence-panel.png` — the four state-changing actions, each with the
refusal the contract will give. The buttons stay live: the app predicts, the chain
decides. Every refusal below was produced by clicking one of these, not by a
console call.

## Agreement #2 — the release path, 0.01 GEN

| File | What it shows | Transaction |
|---|---|---|
| `01-create-agreement.png` | 0.01 GEN escrowed, B named as responsible party, `AWAITING_ACCEPTANCE` | `0x2e204dcb…a81f0e6b` |
| `02-accept-refused-wrong-wallet.png` | **refused** — A tries to accept its own agreement: *Only the named responsible party may accept the duty* | `0x5179453f…3a267619` |
| `03-accepted-active.png` | B accepts; `ACTIVE`, two wallets bound to one immutable duty text | `0x7507c0e8…65361ed9` |
| `04-propose-refused-outsider.png` | **refused** — C proposes a clause: *Only a party to this agreement may propose*. Attempts stay `0`, no semantic budget spent | `0xcff331c3…fff883fd` |
| `05-self-judging-verdict.png` | *"determined by the vendor in its sole discretion"* → `SELF_JUDGING_AUTHORITY`, blocked, fresh consensus, escrow frozen | `0xa7bdcd3b…627d605f` |
| `06-self-judging-state.png` | The same agreement: blocked self-judging `1`, still no determination in force | — |
| `07-release-refused.png` | **refused** — *No independent determination clause is in force*. Escrow still `0.01 GEN` | `0x2da577ba…e1386719` |
| `08-independent-awaiting-signature.png` | *"determined by a third-party monitoring service jointly selected by both parties"* → `INDEPENDENT_DETERMINATION`, but only **AWAITING SIGNATURE**; `active_determination_id` still `0` | `0x69664faf…f0d16a1e` |
| `09-countersign-refused-proposer.png` | **refused** — *The proposing party cannot countersign its own clause* | `0xda5b95ae…de7117d5` |
| `10-determination-in-force.png` | B countersigns; Determination #1 (v1) **in force**, proposed by A and countersigned by B | `0xb8538def…aaace129` |
| `11-refund-refused-in-force.png` | **refused** — *An independent determination clause is already in force*. The obligee is bound to it | `0xaec8abb0…b06b05b8` |
| `12-released.png` | `RELEASED`, escrow `0 GEN` | `0x07d6c590…4f3aa391` |
| `13-balance-responsible-party.png` | Wallet B at **100.01 GEN** — the transfer Direct Mode cannot observe | — |

`07-release-refused.png` and `12-released.png` are the same call, from the same
wallet, on the same agreement. The only thing that changed between them is the
semantic verdict standing on a sentence.

## Agreement #1 — the refund path, 0.005 GEN, 30-minute window

| File | What it shows | Transaction |
|---|---|---|
| `14-refunded.png` | After the window elapsed: `REFUNDED`, escrow `0 GEN`, one self-judging block and no determination ever in force | `0xdfcac68d…8d8338b8` |
| `15-balance-obligee.png` | Wallet A after the reclaim | — |

## What is not here

Four transactions were executed without a screenshot being kept:

- `create_agreement`, `accept_duty` and the self-judging proposal for Agreement #1
  — the finalized state in `14-refunded.png` shows the result of all three
  (`REFUNDED`, `attempts 1`, `blocked self-judging 1`);
- `refund_escrow` before the deadline, `0xbd2328b0…70191a41`, which returned
  *Refund deadline has not passed*.

They are named rather than reconstructed. `00-consequence-panel.png` shows the
same predicted refusal on the same agreement, but it is a screenshot of the
interface, not of that transaction.
