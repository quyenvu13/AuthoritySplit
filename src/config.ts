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
  '0x6c743D9b9c4fdE8e8083125c908E14e7234Ce2be'
) as `0x${string}`;

export const SOURCE_SHA256 =
  'b13978e8fd162ac7fb88764aeff40eae8d84eb790865c05ab73bc94c2660d2d1';

export const EXPECTED_CONTRACT_VERSION = '2.0';
export const EXPECTED_SEMANTIC_BUDGET = 8;

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com';
export const CONTRACT_EXPLORER_URL = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
