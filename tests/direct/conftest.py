"""Fixtures for the AuthoritySplit Direct Mode suite.

Every test runs `contracts/AuthoritySplit.py` inside a real GenVM build. The
GenVM version is pinned so a clean machine executes the same runtime rather than
resolving "latest".
"""
import os
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = str(
    pathlib.Path(os.environ.get("AUTHORITYSPLIT_CONTRACT")
                 or ROOT / "contracts" / "AuthoritySplit.py")
)
GENVM_VERSION = os.environ.get("GENVM_VERSION", "v0.2.12")

ANY_PROMPT = r".*meta-right classification.*"
INDEPENDENT = '{"verdict": "INDEPENDENT_DETERMINATION"}'
SELF_JUDGING = '{"verdict": "SELF_JUDGING_AUTHORITY"}'

START = "2026-09-10T12:00:00.000000Z"
WINDOW = 7 * 24 * 3600
ESCROW = 10_000_000_000_000_000        # 0.01 GEN

DUTY = ("The vendor must restore critical incidents within four hours of a "
        "reported outage.")
CLAUSE_OK = ("Restoration completion is determined by a third-party monitoring "
             "service jointly selected by both parties. Neither party may alter "
             "its records or override its final determination.")
CLAUSE_SELF = ("Restoration completion is determined by the vendor in its sole "
               "discretion, recorded in the vendor's own incident system.")


def hex_of(address) -> str:
    if isinstance(address, (bytes, bytearray)):
        return "0x" + bytes(address).hex()
    for attribute in ("as_hex", "hex"):
        value = getattr(address, attribute, None)
        if value is not None:
            return value() if callable(value) else value
    return str(address)


@pytest.fixture
def chain_warp():
    """Move the clock the contract actually reads.

    `direct_vm.warp()` does not refresh `gl.message_raw["datetime"]` in
    genlayer-test 0.29.2, and that key is what `_now_unix()` parses.
    """
    def _warp(stamp: str) -> str:
        gl_module = sys.modules.get("genlayer.gl")
        if gl_module is not None and getattr(gl_module, "message_raw", None):
            gl_module.message_raw["datetime"] = stamp
        return stamp
    _warp(START)
    return _warp
