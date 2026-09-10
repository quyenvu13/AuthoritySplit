"""The consequence the steward asked for, executed on real GenVM.

A determination clause is no longer a registry entry. Escrowed funds are frozen
until an independent determination authority is in force, and a self-judging
clause cannot be activated even when both parties want it.
"""
import json

import pytest

from conftest import (
    CONTRACT, GENVM_VERSION, ANY_PROMPT, INDEPENDENT, SELF_JUDGING,
    DUTY, CLAUSE_OK, CLAUSE_SELF, ESCROW, WINDOW, START, hex_of,
)


def ag(contract, n=1):
    return json.loads(contract.get_agreement(n))


def new_agreement(vm, deploy, obligee, responsible, value=ESCROW):
    contract = deploy(CONTRACT, sdk_version=GENVM_VERSION)
    vm.sender = obligee
    vm.value = value
    try:
        contract.create_agreement(hex_of(responsible), DUTY, WINDOW)
    finally:
        vm.value = 0
    return contract


def accepted(vm, deploy, obligee, responsible):
    contract = new_agreement(vm, deploy, obligee, responsible)
    vm.sender = responsible
    contract.accept_duty(1)
    return contract


# ------------------------------------------------------------------ parties

def test_the_two_parties_must_be_distinct_addresses(
    direct_vm, direct_deploy, direct_alice, chain_warp
):
    contract = direct_deploy(CONTRACT, sdk_version=GENVM_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.value = ESCROW
    try:
        with pytest.raises(Exception, match="must differ from the obligee"):
            contract.create_agreement(hex_of(direct_alice), DUTY, WINDOW)
    finally:
        direct_vm.value = 0


def test_escrow_is_required_at_creation(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = direct_deploy(CONTRACT, sdk_version=GENVM_VERSION)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="Escrow must be greater than zero"):
        contract.create_agreement(hex_of(direct_bob), DUTY, WINDOW)


def test_nothing_can_be_proposed_before_the_duty_is_accepted(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = new_agreement(direct_vm, direct_deploy, direct_alice, direct_bob)
    state = ag(contract)
    assert state["status"] == "AWAITING_ACCEPTANCE"
    assert state["accepted"] is False

    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="not active"):
        contract.propose_determination(1, CLAUSE_OK)


def test_only_the_named_responsible_party_may_accept(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, chain_warp
):
    contract = new_agreement(direct_vm, direct_deploy, direct_alice, direct_bob)
    for who in (direct_alice, direct_charlie):
        direct_vm.sender = who
        with pytest.raises(Exception, match="Only the named responsible party"):
            contract.accept_duty(1)


# ------------------------------------------------- consensus does not activate

def test_an_independent_verdict_only_reaches_pending(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)

    state = ag(contract)
    assert state["active_determination_id"] == 0, (
        "consensus alone must not put a clause in force"
    )
    assert state["pending_clause_text"] == CLAUSE_OK
    assert state["pending_proposed_by"].lower() == hex_of(direct_alice).lower()
    assert state["attempt_count"] == 1
    assert state["semantic_eval_count"] == 1


def test_the_proposer_cannot_countersign_its_own_clause(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)

    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="cannot countersign its own clause"):
        contract.countersign_determination(1)
    assert ag(contract)["active_determination_id"] == 0


def test_an_outsider_cannot_countersign(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="Only a party to this agreement"):
        contract.countersign_determination(1)


def test_countersigning_puts_the_clause_in_force(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)
    direct_vm.sender = direct_bob
    contract.countersign_determination(1)

    state = ag(contract)
    assert state["active_determination_id"] == 1
    assert state["active_determination_text"] == CLAUSE_OK
    assert state["active_proposed_by"].lower() == hex_of(direct_alice).lower()
    assert state["active_countersigned_by"].lower() == hex_of(direct_bob).lower()
    assert state["pending_clause_text"] == ""

    attempt = json.loads(contract.get_attempt(1, 1))
    assert attempt["resulting_determination_id"] == 1


# ------------------------------------------- mutual consent cannot self-judge

def test_mutual_consent_cannot_activate_a_self_judging_clause(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    """The strongest property in the design. Both parties may want the vendor to
    judge itself; the contract still refuses, because the clause never reaches
    pending and there is nothing for either wallet to sign."""
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, SELF_JUDGING)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_SELF)

    state = ag(contract)
    assert state["self_judging_blocks"] == 1
    assert state["active_determination_id"] == 0
    assert state["pending_clause_text"] == ""

    for who in (direct_alice, direct_bob):
        direct_vm.sender = who
        with pytest.raises(Exception, match="No determination clause is awaiting"):
            contract.countersign_determination(1)

    assert ag(contract)["active_determination_id"] == 0


# ----------------------------------------------------------------- the money

def test_escrow_cannot_be_released_without_an_independent_determination(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    """The consequence. Funds are frozen for an agreement whose compliance
    verdict the obligor would control."""
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="No independent determination clause"):
        contract.release_escrow(1)

    # A blocked self-judging clause does not unlock it either.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, SELF_JUDGING)
    contract.propose_determination(1, CLAUSE_SELF)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="No independent determination clause"):
        contract.release_escrow(1)

    # Nor does a clause that passed consensus but was never countersigned.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    contract.propose_determination(1, CLAUSE_OK)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="No independent determination clause"):
        contract.release_escrow(1)

    assert ag(contract)["escrow_wei"] == str(ESCROW)


def test_release_works_once_the_clause_is_in_force(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)
    direct_vm.sender = direct_bob
    contract.countersign_determination(1)

    direct_vm.sender = direct_alice
    contract.release_escrow(1)

    state = ag(contract)
    assert state["status"] == "RELEASED"
    assert state["escrow_wei"] == "0"

    # Terminal: no second release, and no refund afterwards.
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="not active"):
        contract.release_escrow(1)
    with pytest.raises(Exception, match="already settled"):
        contract.refund_escrow(1)


def test_only_the_obligee_may_release(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)
    direct_vm.sender = direct_bob
    contract.countersign_determination(1)

    for who in (direct_bob, direct_charlie):
        direct_vm.sender = who
        with pytest.raises(Exception, match="Only the obligee may release"):
            contract.release_escrow(1)


# --------------------------------------------------- the escape hatch audit

def test_refund_needs_the_deadline_and_is_obligee_only(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, chain_warp
):
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="Refund deadline has not passed"):
        contract.refund_escrow(1)

    chain_warp("2026-10-01T12:00:00.000000Z")
    for who in (direct_bob, direct_charlie):
        direct_vm.sender = who
        with pytest.raises(Exception, match="Only the obligee may reclaim"):
            contract.refund_escrow(1)

    direct_vm.sender = direct_alice
    contract.refund_escrow(1)
    state = ag(contract)
    assert state["status"] == "REFUNDED"
    assert state["escrow_wei"] == "0"


def test_the_refund_cannot_escape_an_active_determination(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    """§7 escape-path audit. Once an independent clause is in force the obligee
    is bound to it and cannot pull the escrow back, even past the deadline."""
    contract = accepted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, INDEPENDENT)
    direct_vm.sender = direct_alice
    contract.propose_determination(1, CLAUSE_OK)
    direct_vm.sender = direct_bob
    contract.countersign_determination(1)

    chain_warp("2027-01-01T12:00:00.000000Z")
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="already in force"):
        contract.refund_escrow(1)
    assert ag(contract)["escrow_wei"] == str(ESCROW)


def test_refund_is_available_while_the_duty_was_never_accepted(
    direct_vm, direct_deploy, direct_alice, direct_bob, chain_warp
):
    contract = new_agreement(direct_vm, direct_deploy, direct_alice, direct_bob)
    chain_warp("2026-10-01T12:00:00.000000Z")
    direct_vm.sender = direct_alice
    contract.refund_escrow(1)
    assert ag(contract)["status"] == "REFUNDED"
