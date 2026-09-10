#!/usr/bin/env python3
"""Mutation check — does the AuthoritySplit suite actually have teeth?

A green suite proves nothing until it is shown to fail when the contract is
wrong. This makes small, targeted edits to `contracts/AuthoritySplit.py` -
each one a plausible mistake that breaks a property the suite claims to protect -
and runs the whole Direct Mode suite against each mutant on real GenVM.

  KILLED    at least one test failed. The property is genuinely defended.
  SURVIVED  every test still passed. That mutant is an untested gap.

Nothing under `contracts/` is modified: each mutant goes to a temporary
directory and the suite is pointed at it through AUTHORITYSPLIT_CONTRACT.

    python3 scripts/mutation_matrix.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = os.path.join(ROOT, "contracts", "AuthoritySplit.py")
TESTS = os.path.join(ROOT, "tests", "direct")

MUTANTS = [
    ("M01", "the obligee may name itself as responsible party",
     "        if responsible == obligee:",
     "        if False:"),
    ("M02", "a duty may be judged before it is accepted",
     '        if sender != agreement.obligee and sender != agreement.responsible_party:\n'
     '            raise gl.vm.UserError("Only a party to this agreement may propose")\n'
     '        if agreement.status != STATUS_ACTIVE:',
     '        if sender != agreement.obligee and sender != agreement.responsible_party:\n'
     '            raise gl.vm.UserError("Only a party to this agreement may propose")\n'
     '        if False:'),
    ("M03", "anyone may accept the duty",
     "        if gl.message.sender_address != agreement.responsible_party:",
     "        if False:"),
    ("M04", "the proposer may countersign its own clause",
     "        if sender == pending_clause.proposed_by:",
     "        if False:"),
    ("M05", "an outsider may countersign",
     "        if sender != agreement.obligee and sender != agreement.responsible_party:\n            raise gl.vm.UserError(\"Only a party to this agreement may countersign\")",
     "        if False:\n            raise gl.vm.UserError(\"Only a party to this agreement may countersign\")"),
    ("M06", "an outsider may propose",
     "        if sender != agreement.obligee and sender != agreement.responsible_party:\n            raise gl.vm.UserError(\"Only a party to this agreement may propose\")",
     "        if False:\n            raise gl.vm.UserError(\"Only a party to this agreement may propose\")"),
    ("M07", "a self-judging clause still reaches the signature stage",
     "        if accepted:\n            # Consensus does not activate anything on its own.",
     "        if True:\n            # Consensus does not activate anything on its own."),
    ("M08", "escrow releases without an independent determination",
     '        if int(agreement.active_determination_id) == 0:\n            raise gl.vm.UserError(\n                "No independent determination clause is in force"\n            )',
     "        if False:\n            raise gl.vm.UserError(\n                \"No independent determination clause is in force\"\n            )"),
    ("M09", "anyone may release the escrow",
     '        if gl.message.sender_address != agreement.obligee:\n            raise gl.vm.UserError("Only the obligee may release escrow")',
     '        if False:\n            raise gl.vm.UserError("Only the obligee may release escrow")'),
    ("M10", "the refund escapes an active determination",
     '        if int(agreement.active_determination_id) > 0:\n            raise gl.vm.UserError(\n                "An independent determination clause is already in force"\n            )',
     "        if False:\n            raise gl.vm.UserError(\n                \"An independent determination clause is already in force\"\n            )"),
    ("M11", "the refund ignores its deadline",
     "        if self._now_unix() < int(agreement.refund_deadline_unix):",
     "        if False:"),
    ("M12", "anyone may reclaim the escrow",
     '        if gl.message.sender_address != agreement.obligee:\n            raise gl.vm.UserError("Only the obligee may reclaim escrow")',
     '        if False:\n            raise gl.vm.UserError("Only the obligee may reclaim escrow")'),
    ("M13", "an agreement may be created with no escrow",
     '        if escrow <= 0:\n            raise gl.vm.UserError("Escrow must be greater than zero")',
     '        if False:\n            raise gl.vm.UserError("Escrow must be greater than zero")'),
    ("M14", "malformed consensus output becomes a verdict",
     '            if verdict not in (\n                INDEPENDENT_DETERMINATION,\n                SELF_JUDGING_AUTHORITY,\n            ):\n                raise gl.vm.UserError("Invalid semantic verdict")',
     '            if verdict not in (\n                INDEPENDENT_DETERMINATION,\n                SELF_JUDGING_AUTHORITY,\n            ):\n                return {"verdict": SELF_JUDGING_AUTHORITY}'),
    ("M15", "the verdict cache is shared across agreements",
     "            str(int(agreement_id))\n            + \"|\"\n            + self._hash_text(responsible_party_label)",
     "            \"\"\n            + \"|\"\n            + self._hash_text(responsible_party_label)"),
    ("M16", "the semantic budget is removed",
     "                int(agreement.semantic_eval_count)\n                >= self.MAX_SEMANTIC_EVALS_PER_AGREEMENT",
     "                int(agreement.semantic_eval_count)\n                >= 100000"),
    ("M17", "a released agreement can be released again",
     '        if agreement.status != STATUS_ACTIVE:\n            raise gl.vm.UserError("Agreement is not active")\n\n        # The consequence',
     '        if False:\n            raise gl.vm.UserError("Agreement is not active")\n\n        # The consequence'),
    ("M18", "a settled agreement can still be refunded",
     "        if agreement.status not in (\n            STATUS_AWAITING_ACCEPTANCE,\n            STATUS_ACTIVE,\n        ):",
     "        if False:"),
    ("M19", "an identical clause may replace the one in force",
     '            if candidate == active_record.text:\n                raise gl.vm.UserError(\n                    "Candidate matches active determination clause"\n                )',
     "            if False:\n                raise gl.vm.UserError(\n                    \"Candidate matches active determination clause\"\n                )"),
    ("M20", "the prompt fence stops neutralising angle brackets",
     '        cleaned = text.replace("<", " ").replace(">", " ")',
     "        cleaned = text"),
]


def run_suite(contract_path):
    env = dict(os.environ, AUTHORITYSPLIT_CONTRACT=contract_path)
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", TESTS, "-q", "-p", "no:cacheprovider"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    return proc.returncode


def main():
    source = open(CONTRACT, encoding="utf-8").read()

    if run_suite(CONTRACT) != 0:
        print("Baseline suite is already failing; fix that first.")
        return 1
    print("baseline            PASS\n")

    workdir = tempfile.mkdtemp(prefix="authoritysplit-mutants-")
    killed, survived, invalid = [], [], []

    try:
        for mutant_id, description, old, new in MUTANTS:
            if source.count(old) != 1:
                invalid.append((mutant_id, description))
                print(f"{mutant_id}  INVALID   pattern matched "
                      f"{source.count(old)} times -- {description}")
                continue

            path = os.path.join(workdir, f"{mutant_id}.py")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(source.replace(old, new))

            if run_suite(path) == 0:
                survived.append((mutant_id, description))
                print(f"{mutant_id}  SURVIVED  {description}")
            else:
                killed.append((mutant_id, description))
                print(f"{mutant_id}  killed    {description}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(f"\n{len(killed)}/{len(MUTANTS)} killed, {len(survived)} survived, "
          f"{len(invalid)} invalid")

    if survived or invalid:
        print("\nUntested gaps:")
        for mutant_id, description in survived + invalid:
            print(f"  {mutant_id}  {description}")

    return 0 if not survived and not invalid else 1


if __name__ == "__main__":
    sys.exit(main())
