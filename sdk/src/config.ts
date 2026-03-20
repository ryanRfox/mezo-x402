/**
 * Mezo network CAIP-2 identifiers.
 */
export const MEZO_TESTNET = "eip155:31611" as const;
export const MEZO_MAINNET = "eip155:31612" as const;

/**
 * mUSD token configuration for x402.
 * mUSD is Mezo's Bitcoin-backed stablecoin (ERC-20, 18 decimals).
 * It lacks EIP-3009, so permit2 is the only viable x402 payment path.
 */
export const MUSD_CONFIG = {
  /** mUSD contract address on Mezo testnet */
  testnet: {
    address: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const,
    name: "Mezo USD",
    version: "1",
    decimals: 18,
  },
  /** mUSD contract address on Mezo mainnet */
  mainnet: {
    address: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186" as const,
    name: "Mezo USD",
    version: "1",
    decimals: 18,
  },
} as const;

/**
 * x402 stablecoin map entries for Mezo networks.
 * These can be added to the server scheme's stablecoin map.
 */
export const MEZO_STABLECOIN_MAP = {
  [MEZO_TESTNET]: MUSD_CONFIG.testnet,
  [MEZO_MAINNET]: MUSD_CONFIG.mainnet,
} as const;
