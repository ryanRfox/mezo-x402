import { useState, useCallback } from "react";
import { usePublicClient, useConfig } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { wagmiToClientSigner } from "./wagmiToClientSigner";
import { mezoTestnet } from "./config";

const HUMOR_SERVER_URL =
  import.meta.env.VITE_HUMOR_SERVER_URL || "";

type PaymentState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "settling" }
  | { status: "success"; joke: { setup: string; punchline: string }; txHash: string }
  | { status: "error"; message: string };

export function usePayForJoke() {
  const [state, setState] = useState<PaymentState>({ status: "idle" });
  const publicClient = usePublicClient();
  const wagmiCfg = useConfig();

  const pay = useCallback(async () => {
    if (!publicClient) {
      setState({ status: "error", message: "Public client not available" });
      return;
    }

    try {
      setState({ status: "signing" });

      const walletClient = await getWalletClient(wagmiCfg, { chainId: mezoTestnet.id });
      const signer = wagmiToClientSigner(walletClient, publicClient);
      const client = new x402Client();
      client.register("eip155:*", new ExactEvmScheme(signer));

      setState({ status: "settling" });

      const fetchWithPay = wrapFetchWithPayment(fetch, client);
      const response = await fetchWithPay(`${HUMOR_SERVER_URL}/joke`);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const joke = await response.json();
      const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
      const txHash = paymentHeader
        ? decodePaymentResponseHeader(paymentHeader)?.transaction || "unknown"
        : "unknown";

      setState({ status: "success", joke, txHash });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Payment failed";
      setState({ status: "error", message });
    }
  }, [publicClient, wagmiCfg]);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, pay, reset };
}
