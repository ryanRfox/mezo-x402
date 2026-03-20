import { type Chain } from "viem";

/**
 * Mezo Testnet chain definition for viem.
 * Chain ID: 31611 (CAIP-2: eip155:31611)
 */
export const mezoTestnet = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: {
    name: "BTC",
    symbol: "BTC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.test.mezo.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.test.mezo.org",
    },
  },
  testnet: true,
} as const satisfies Chain;

/**
 * Mezo Mainnet chain definition for viem.
 * Chain ID: 31612 (CAIP-2: eip155:31612)
 */
export const mezoMainnet = {
  id: 31612,
  name: "Mezo",
  nativeCurrency: {
    name: "BTC",
    symbol: "BTC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mezo.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.mezo.org",
    },
  },
  testnet: false,
} as const satisfies Chain;

/**
 * Local anvil chain definition for development.
 * Chain ID: 31337 (CAIP-2: eip155:31337)
 */
export const anvil = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
  testnet: true,
} as const satisfies Chain;

/**
 * Map CAIP-2 network ID to viem Chain.
 */
export function getMezoChain(network: string): Chain {
  switch (network) {
    case "eip155:31337":
      return anvil;
    case "eip155:31611":
      return mezoTestnet;
    case "eip155:31612":
      return mezoMainnet;
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}
