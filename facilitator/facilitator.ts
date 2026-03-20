/**
 * Mezo x402 Facilitator
 *
 * Upstream-pattern facilitator for the Mezo network with EIP-7623 gas workaround,
 * verify-before-settle lifecycle hooks, and educational logging.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import { Network, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getMezoChain } from "mezo-x402-sdk/chains";

dotenv.config();

const PORT = process.env.PORT || "4022";
const NETWORK = process.env.NETWORK || "eip155:31611";
const RPC_URL = process.env.MEZO_RPC_URL || (NETWORK === "eip155:31337" ? "http://127.0.0.1:8545" : "https://rpc.test.mezo.org");
const SETTLE_TIMEOUT_MS = parseInt(process.env.SETTLE_TIMEOUT_MS || "300000"); // 5 min

if (!process.env.FACILITATOR_PRIVATE_KEY) {
  console.error("FACILITATOR_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

const account = privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`);
const chain = getMezoChain(NETWORK);
const viemClient = createWalletClient({ account, chain, transport: http(RPC_URL) }).extend(publicActions);

console.info(`Facilitator address: ${account.address}`);
console.info(`Network: ${NETWORK}`);
console.info(`RPC: ${RPC_URL}`);

const evmSigner = toFacilitatorEvmSigner({
  address: account.address,
  readContract: (args) => viemClient.readContract({ ...args, args: args.args || [] }),
  verifyTypedData: (args) => viemClient.verifyTypedData(args as any),
  writeContract: async (args) => {
    // WORKAROUND (mz-0791): Mezo's eth_estimateGas returns only execution_cost, not
    // max(execution_cost, floor) as required when EIP-7623 is active. For Permit2
    // settle() the calldata floor (~30,160) exceeds the execution estimate (~24,664),
    // causing the tx to fail with "gas floor exceeds gas limit". 3x multiplier provides
    // sufficient headroom across varying estimate ranges.
    // TODO: Remove once Mezo fixes eth_estimateGas to include the EIP-7623 calldata floor.
    const estimated = await viemClient.estimateContractGas({ ...args, args: args.args || [], account });
    return viemClient.writeContract({ ...args, args: args.args || [], gas: estimated * 3n });
  },
  sendTransaction: (args) => viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args) => viemClient.waitForTransactionReceipt(args),
  getCode: (args) => viemClient.getCode(args),
});

// Verify-before-settle tracking
const verifiedPayments = new Map<string, number>();

function paymentHash(p: PaymentPayload): string {
  return crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex");
}

// Initialize facilitator with ExactEvmScheme directly
const facilitator = new x402Facilitator();
facilitator.register(NETWORK as Network, new ExactEvmScheme(evmSigner));

// Lifecycle hooks: verify-before-settle enforcement + educational logging
facilitator
  .onAfterVerify(async (ctx) => {
    if (ctx.result.isValid) {
      const h = paymentHash(ctx.paymentPayload);
      verifiedPayments.set(h, Date.now());
      console.log(`[VERIFY] Payment hash tracked for settle: ${h.slice(0, 12)}...`);
    }
  })
  .onBeforeSettle(async (ctx) => {
    const h = paymentHash(ctx.paymentPayload);
    const ts = verifiedPayments.get(h);
    if (!ts) {
      console.warn(`[SETTLE] REJECTED: hash ${h.slice(0, 12)}... was never verified`);
      return { abort: true, reason: "Payment must be verified before settlement" };
    }
    const age = Date.now() - ts;
    if (age > SETTLE_TIMEOUT_MS) {
      verifiedPayments.delete(h);
      console.warn(`[SETTLE] REJECTED: hash ${h.slice(0, 12)}... verification expired (${age}ms > ${SETTLE_TIMEOUT_MS}ms)`);
      return { abort: true, reason: "Payment verification expired (must settle within 5 minutes)" };
    }
    console.log(`[SETTLE] Verify-before-settle check passed: hash ${h.slice(0, 12)}... verified ${age}ms ago`);
  })
  .onAfterSettle(async (ctx) => {
    const h = paymentHash(ctx.paymentPayload);
    verifiedPayments.delete(h);
    if (ctx.result.success) {
      const req = ctx.requirements as PaymentRequirements;
      const amountMusd = req?.amount ? (Number(req.amount) / 1e18).toFixed(4) : "?";
      console.log(`[SETTLE] <- Settlement completed: tx=${ctx.result.transaction}, network=${ctx.result.network}`);
      console.log(`[SETTLE]   payer=${(ctx.result as any).payer} -> payee=${req?.payTo}, amount=${amountMusd} mUSD`);
    } else {
      const failedTx = (ctx.result as any).transaction;
      const errorReason = (ctx.result as any).errorReason;
      console.error(`[SETTLE] <- Settlement returned failure: errorReason=${errorReason}${failedTx ? `, tx=${failedTx}` : " (no tx)"}`);
      if (failedTx) console.error(`[SETTLE]   Explorer: https://explorer.test.mezo.org/tx/${failedTx}`);
    }
  })
  .onSettleFailure(async (ctx) => {
    verifiedPayments.delete(paymentHash(ctx.paymentPayload));
    console.error(`[SETTLE] <- Settlement failed: ${ctx.error.message}`);
  });

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
    console.log(`[VERIFY] -> Received verify request: scheme=${paymentPayload?.accepted?.scheme}, network=${paymentPayload?.accepted?.network}`);
    const response: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements);
    console.log(`[VERIFY] <- Result: isValid=${response.isValid}${response.invalidReason ? `, reason=${response.invalidReason}` : ""}${response.payer ? `, payer=${response.payer}` : ""}`);
    res.json(response);
  } catch (error) {
    console.error("[VERIFY] Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  console.log(`[SETTLE] -> Received settle request`);
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: SettleResponse = await facilitator.settle(paymentPayload as PaymentPayload, paymentRequirements as PaymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);
    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      } as SettleResponse);
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", async (_req, res) => {
  try {
    res.json(facilitator.getSupported());
  } catch (error) {
    console.error("Supported error:", error);
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
