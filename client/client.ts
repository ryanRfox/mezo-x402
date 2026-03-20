/**
 * Mezo x402 Client — pays for paywalled resources using mUSD via permit2.
 *
 * Usage: cp .env.example .env && npx tsx client.ts
 */

// These two side-effect imports MUST come before @x402/evm:
// 1. preload: polyfills globalThis.crypto for Node < 20 / tsx CJS mode
// 2. dotenv/config: loads .env so PROXY_ADDRESS is set when SDK reads it at module-load time
import "./preload.js";
import "dotenv/config";

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getMezoChain } from "mezo-x402-sdk";
import { PERMIT2_ADDRESS } from "@x402/evm";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:3000/joke";
const NETWORK = process.env.NETWORK || "eip155:31337";
const RPC_URL = process.env.RPC_URL || process.env.MEZO_RPC_URL || "http://127.0.0.1:8545";
const MUSD_ADDRESS = process.env.MUSD_ADDRESS as `0x${string}` | undefined;

async function main() {
  if (!process.env.CLIENT_PRIVATE_KEY) {
    console.error("CLIENT_PRIVATE_KEY environment variable is required");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);
  console.log(`Client wallet: ${account.address}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`RPC: ${RPC_URL}`);

  // Set up viem public client for balance/allowance checks
  const chain = getMezoChain(NETWORK);
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });

  // Check mUSD balance if we know the token address
  let startBalance = 0n;
  if (MUSD_ADDRESS) {
    startBalance = await publicClient.readContract({
      address: MUSD_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    console.log(`mUSD balance: ${startBalance} (${(Number(startBalance) / 1e18).toFixed(4)} mUSD)`);

    // Check Permit2 allowance
    const permit2Addr = (process.env.PERMIT2_ADDRESS || PERMIT2_ADDRESS) as `0x${string}`;
    const allowance = await publicClient.readContract({
      address: MUSD_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, permit2Addr],
    });
    if (allowance === 0n) {
      console.warn("WARNING: mUSD not approved for Permit2. Run deploy-local.sh or approve manually.");
    }
  }

  // Create x402 client with EVM exact scheme
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));
  const httpClient = new x402HTTPClient(client);

  // Step 1: Request the resource — expect 402
  // Manual 402 flow for educational visibility. Production: use wrapFetchWithPayment() from @x402/fetch.
  console.log(`\nRequesting: ${RESOURCE_URL}`);
  const initialResponse = await fetch(RESOURCE_URL);

  if (initialResponse.status !== 402) {
    console.log(`Got ${initialResponse.status} (expected 402):`);
    const body = await initialResponse.text();
    console.log(body);
    return;
  }

  console.log("Got 402 Payment Required");

  // Step 2: Extract PaymentRequired from response headers (v2) or body (v1)
  let paymentRequired;
  try {
    paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => initialResponse.headers.get(name),
      await initialResponse.clone().json().catch(() => undefined),
    );
  } catch (err) {
    console.error("Failed to parse payment requirements:", err);
    return;
  }

  console.log(`Payment requirements:`, JSON.stringify(paymentRequired, null, 2));

  // Step 3: Create payment payload (signs permit2 EIP-712 message)
  console.log("\nSigning payment...");
  let paymentPayload;
  try {
    paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  } catch (err) {
    console.error("Failed to create payment payload:", err);
    return;
  }

  // Step 4: Encode as HTTP header and retry
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  console.log("Payment signed, retrying with payment header...");

  const paidResponse = await fetch(RESOURCE_URL, {
    headers: paymentHeaders,
  });

  if (!paidResponse.ok) {
    console.error(`Payment failed: ${paidResponse.status}`);
    const body = await paidResponse.text();
    console.error(body);
    return;
  }

  // Step 5: Extract settlement response (PAYMENT RECEIPT) from PAYMENT-RESPONSE header
  let settleResponse;
  try {
    settleResponse = httpClient.getPaymentSettleResponse(
      (name) => paidResponse.headers.get(name),
    );
  } catch {
    console.warn("  No PAYMENT-RESPONSE header in response");
  }

  const data = await paidResponse.json();

  console.log("\n=== Payment Successful ===");
  console.log("Data:", JSON.stringify(data, null, 2));

  if (settleResponse) {
    console.log("\nPAYMENT-RESPONSE received (payment receipt from resource server):");
    console.log(`  success:     ${settleResponse.success}`);
    console.log(`  transaction: ${settleResponse.transaction}`);
    console.log(`  network:     ${settleResponse.network}`);
    if (settleResponse.payer) console.log(`  payer:       ${settleResponse.payer}`);
  } else {
    console.warn("WARNING: No PAYMENT-RESPONSE header received from resource server (spec violation)");
  }

  // Show ending balance and delta to confirm on-chain settlement
  if (MUSD_ADDRESS) {
    const endBalance = await publicClient.readContract({
      address: MUSD_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const delta = startBalance - endBalance;
    console.log(`\nmUSD balance after:  ${endBalance} (${(Number(endBalance) / 1e18).toFixed(4)} mUSD)`);
    console.log(`mUSD balance before: ${startBalance} (${(Number(startBalance) / 1e18).toFixed(4)} mUSD)`);
    console.log(`mUSD deducted:       ${delta} (${(Number(delta) / 1e18).toFixed(4)} mUSD)`);
  }

  if (settleResponse?.transaction) {
    console.log(`Tx hash: ${settleResponse.transaction}`);
  }
  console.log(`Network: ${settleResponse?.network || NETWORK}`);
}

main().catch((err) => {
  console.error("Client error:", err);
  process.exit(1);
});
