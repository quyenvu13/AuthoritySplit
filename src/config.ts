export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  '0xA614c22Ea5bF0bAc17338a9539514fa6d2b050Ef'
) as `0x${string}`;

export const RUNTIME_EVIDENCE_ADDRESS =
  '0xD7E04011737411f02315D1864956Ec739049ccf1' as `0x${string}`;

export const SOURCE_SHA256 =
  'ce722d4e1708b900ceff3fa8d3ff2233a12f2e3315911dda88e0ccc65c9b2139';

export const EXPECTED_CONTRACT_VERSION = '1.2';
export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com';
export const CONTRACT_EXPLORER_URL = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const RUNTIME_EXPLORER_URL = `${EXPLORER_BASE}/address/${RUNTIME_EVIDENCE_ADDRESS}`;
