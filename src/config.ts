/**
 * Deployment configuration.
 *
 * `SOURCE_SHA256` is the SHA-256 of `contracts/AuthoritySplit.py` in this
 * repository. It is checked by `npm run verify` and displayed on the
 * Verification page so a reviewer can confirm the frontend targets the same
 * source that the test suite and the mutation matrix ran against.
 */
export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  '0x0000000000000000000000000000000000000000'
) as `0x${string}`;

export const SOURCE_SHA256 =
  'd1ff73c8a650f8932a50046fb03c17aa0acedf9d40890091002d47bea4a860f6';

export const EXPECTED_CONTRACT_VERSION = '2.0';
export const EXPECTED_SEMANTIC_BUDGET = 8;

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com';
export const CONTRACT_EXPLORER_URL = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
