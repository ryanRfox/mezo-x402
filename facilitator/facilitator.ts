/**
 * Mezo x402 Facilitator
 *
 * Standalone Express facilitator mirroring the upstream @x402/core pattern.
 * Registers ExactEvmScheme for eip155:31611 with EIP-2612 gas sponsoring.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import dotenv from "dotenv";
import express from "express";
import { type Chain, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config();

// Mezo Testnet chain definition (viem doesn't have it yet)
const mezoTestnet = {
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

const PORT = process.env.PORT || "4022";
const NETWORK: Network = "eip155:31611";
const RPC_URL = process.env.MEZO_RPC_URL || "https://rpc.test.mezo.org";

if (!process.env.FACILITATOR_PRIVATE_KEY) {
  console.error("FACILITATOR_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

const account = privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`);
const viemClient = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC_URL) }).extend(publicActions);

console.info(`Facilitator address: ${account.address}`);
console.info(`Network: ${NETWORK}`);
console.info(`RPC: ${RPC_URL}`);

const evmSigner = toFacilitatorEvmSigner({
  address: account.address,
  readContract: (args) => viemClient.readContract({ ...args, args: args.args || [] }),
  verifyTypedData: (args) => viemClient.verifyTypedData(args as any),
  writeContract: (args) => viemClient.writeContract({ ...args, args: args.args || [] }),
  sendTransaction: (args) => viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args) => viemClient.waitForTransactionReceipt(args),
  getCode: (args) => viemClient.getCode(args),
});

// Initialize facilitator with ExactEvmScheme
const facilitator = new x402Facilitator();
facilitator.register(NETWORK, new ExactEvmScheme(evmSigner));

// Register EIP-2612 gas sponsoring extension (mUSD supports EIP-2612 permit)
facilitator.registerExtension({ key: "eip2612GasSponsoring" });

// Express app
const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements);
    console.log(`[VERIFY] valid=${response.isValid}`);
    res.json(response);
  } catch (error) {
    console.error("[VERIFY] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );
    console.log(`[SETTLE] success=${response.success} tx=${response.transaction}`);
    res.json(response);
  } catch (error) {
    console.error("[SETTLE] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", async (_req, res) => {
  try {
    res.json(facilitator.getSupported());
  } catch (error) {
    console.error("[SUPPORTED] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK, facilitator: "mezo-x402", version: "1.0.0" });
});

app.post("/close", (_req, res) => {
  res.json({ message: "Facilitator shutting down gracefully" });
  console.log("Received shutdown request");
  setTimeout(() => process.exit(0), 100);
});

app.listen(parseInt(PORT), () => {
  console.log(`Mezo x402 Facilitator listening on port ${PORT}`);
  console.log(`  POST /verify`);
  console.log(`  POST /settle`);
  console.log(`  GET  /supported`);
  console.log(`  GET  /health`);
  console.log(`  POST /close`);
  console.log("Facilitator listening");
});
