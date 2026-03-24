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

export const GUI_VERSION = "0.3.1";

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
      console.log("[x402] Starting payment flow...");

      const walletClient = await getWalletClient(wagmiCfg, { chainId: mezoTestnet.id });
      console.log("[x402] Wallet client obtained, chain:", (walletClient as { chain?: { id: number } }).chain?.id);

      const signer = wagmiToClientSigner(walletClient, publicClient);
      const client = new x402Client();
      client.register("eip155:*", new ExactEvmScheme(signer));

      setState({ status: "settling" });
      const fetchWithPay = wrapFetchWithPayment(fetch, client);
      console.log("[x402] Fetching /joke (x402-aware, will handle 402 automatically)...");
      const response = await fetchWithPay(`${HUMOR_SERVER_URL}/joke`);

      console.log("[x402] Response status:", response.status);
      console.log("[x402] Response headers:", {
        "PAYMENT-RESPONSE": response.headers.get("PAYMENT-RESPONSE")?.slice(0, 50),
        "PAYMENT-REQUIRED": response.headers.get("PAYMENT-REQUIRED")?.slice(0, 50),
        "content-type": response.headers.get("content-type"),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("[x402] Non-OK response body:", body.slice(0, 500));
        throw new Error(`Payment failed (${response.status}): ${body.slice(0, 100) || "no details"}`);
      }

      const joke = await response.json();
      const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
      const txHash = paymentHeader
        ? decodePaymentResponseHeader(paymentHeader)?.transaction || "unknown"
        : "unknown";

      console.log("[x402] Payment success! TX:", txHash);
      setState({ status: "success", joke, txHash });
    } catch (err: unknown) {
      console.error("[x402] Payment error:", err);
      const message = err instanceof Error ? err.message : "Payment failed";
      setState({ status: "error", message });
    }
  }, [publicClient, wagmiCfg]);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, pay, reset };
}
