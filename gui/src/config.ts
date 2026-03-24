import { defineChain } from "viem";
import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" },
  },
  testnet: true,
});

export const MUSD_ADDRESS = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const;
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const EXPLORER_URL = "https://explorer.test.mezo.org";

export const config = createConfig({
  chains: [mezoTestnet],
  connectors: [injected()],
  transports: {
    [mezoTestnet.id]: http(),
  },
});
