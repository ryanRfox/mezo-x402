/**
 * Mezo x402 Humor Server — joke paywall demo.
 *
 * GET /joke  — setup is free; pay mUSD to unlock the punchline
 * POST /add  — add a new joke to the flat-file DB (free)
 *
 * Usage:
 *   source ../.env.mezo.testnet && tsx humor-server.ts
 *
 * Usage (local anvil):
 *   source ../.anvil.env && tsx humor-server.ts
 */

import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall, evmPaywall } from "@x402/paywall";
import dotenv from "dotenv";
import express from "express";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Network } from "@x402/core/types";
import { MUSD_CONFIG } from "mezo-x402-sdk";

dotenv.config();

if (!process.env.PAYEE_ADDRESS) {
  console.error("Error: PAYEE_ADDRESS is required. Copy .env.example to .env and fill in your wallet address.");
  process.exit(1);
}

const RESOURCE_PORT = parseInt(process.env.HUMOR_PORT || process.env.PORT || "3000");
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const PAYEE_ADDRESS = process.env.PAYEE_ADDRESS;
const NETWORK = (process.env.NETWORK || "eip155:31611") as Network;
const MUSD_ADDRESS = (process.env.MUSD_ADDRESS as `0x${string}`) || "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JOKES_PATH = join(__dirname, "jokes.json");

interface Joke {
  setup: string;
  punchline: string;
}

function readJokes(): Joke[] {
  return JSON.parse(readFileSync(JOKES_PATH, "utf-8")) as Joke[];
}

function appendJoke(joke: Joke): void {
  const jokes = readJokes();
  jokes.push(joke);
  writeFileSync(JOKES_PATH, JSON.stringify(jokes, null, 2) + "\n");
}

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Create resource server with EVM exact scheme
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("eip155:*", new ExactEvmScheme());

// Paywall config for GET /joke — punchline costs 0.001 mUSD
const httpServer = new x402HTTPResourceServer(resourceServer, {
  "GET /joke": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: PAYEE_ADDRESS,
      price: {
        amount: "1000000000000000", // 0.001 mUSD (18 decimals)
        asset: MUSD_ADDRESS,
        extra: {
          name: MUSD_CONFIG.testnet.name,
          version: MUSD_CONFIG.testnet.version,
          assetTransferMethod: "permit2",
        },
      },
      maxTimeoutSeconds: 300,
    },
    description: "Unlock the punchline",
    mimeType: "application/json",
  },
});

// Register the @x402/paywall provider for rich wallet-connection UI on 402 responses.
// The stock evmPaywall handler assumes USDC (6 decimals) for the display amount.
// mUSD uses 18 decimals, so we wrap it with correct decimal conversion while keeping
// the full paywall React app (which reads raw PaymentRequirements for the actual tx).
const MUSD_DECIMALS = 18;
const mezoEvmPaywall = {
  supports: evmPaywall.supports,
  generateHtml(
    requirement: Parameters<typeof evmPaywall.generateHtml>[0],
    paymentRequired: Parameters<typeof evmPaywall.generateHtml>[1],
    config: Parameters<typeof evmPaywall.generateHtml>[2],
  ) {
    // Temporarily patch the amount to human-readable form so the paywall
    // display renders "0.001" instead of "1000000000" (which evmPaywall
    // would produce by dividing an 18-decimal amount by 10^6).
    const raw = requirement.amount ?? requirement.maxAmountRequired ?? "0";
    const humanAmount = parseFloat(raw) / 10 ** MUSD_DECIMALS;
    // evmPaywall divides by 10^6 internally, so we pre-multiply to cancel it out
    const fakeAmount = (humanAmount * 1e6).toString();
    const patched = { ...requirement, amount: fakeAmount };
    return evmPaywall.generateHtml(patched, paymentRequired, config);
  },
};
const paywallProvider = createPaywall().withNetwork(mezoEvmPaywall).build();
httpServer.registerPaywallProvider(paywallProvider);

const app = express();
app.use(express.json());

// Public info endpoint
app.get("/", (_req, res) => {
  const jokes = readJokes();
  res.json({
    service: "Mezo x402 Humor Server",
    description: "Pay mUSD to hear the punchline",
    network: NETWORK,
    jokeCount: jokes.length,
    endpoints: {
      "/": "This info (free)",
      "/joke": "Random joke — setup free, punchline costs 0.001 mUSD",
      "/add": "POST {setup, punchline} to add a joke (free)",
      "/health": "Health check (free)",
    },
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK, facilitator: FACILITATOR_URL });
});

// Add a joke (free)
app.post("/add", (req, res) => {
  const { setup, punchline } = req.body as { setup?: string; punchline?: string };
  if (!setup || !punchline) {
    res.status(400).json({ error: "Both 'setup' and 'punchline' fields are required" });
    return;
  }
  appendJoke({ setup: String(setup), punchline: String(punchline) });
  const total = readJokes().length;
  console.log(`[humor] POST /add → "${setup}" (total: ${total})`);
  res.status(201).json({ ok: true, total });
});

// Joke endpoint — setup free, punchline paywalled
app.get("/joke", async (req, res) => {
  const jokes = readJokes();
  if (jokes.length === 0) {
    res.status(503).json({ error: "No jokes in the database yet. POST /add to add one!" });
    return;
  }

  const joke = jokes[Math.floor(Math.random() * jokes.length)];

  const context = {
    adapter: {
      getHeader: (name: string) => req.headers[name.toLowerCase()] as string | undefined,
      getMethod: () => req.method,
      getPath: () => req.path,
      getUrl: () => `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      getAcceptHeader: () => req.headers.accept || "",
      getUserAgent: () => req.headers["user-agent"] || "",
    },
    path: req.path,
    method: req.method,
    paymentHeader: (req.headers["x-payment"] || req.headers["payment"]) as string | undefined,
  };

  // INTENTIONAL: paymentMiddlewareFromConfig cannot intercept 402 to inject joke setup. Manual flow required for custom response body.
  const result = await httpServer.processHTTPRequest(context, {
    appName: "Mezo Humor",
    testnet: true,
    currentUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
  });

  if (result.type === "payment-error") {
    // Return 402 with setup visible — client must pay to get punchline
    console.log(`[humor] GET /joke → 402 (setup: "${joke.setup}")`);
    const { status, headers, body, isHtml } = result.response;
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    if (isHtml) {
      res.status(status).type("html").send(body);
    } else {
      res.status(status).json({ ...(body as object), setup: joke.setup, hint: "Pay to unlock the punchline!" });
    }
    return;
  }

  if (result.type === "no-payment-required") {
    res.json({ setup: joke.setup, punchline: joke.punchline });
    return;
  }

  // Payment verified — settle and return punchline
  // INTENTIONAL: Settlement handled manually to include joke punchline in response body alongside payment receipt.
  console.log(`[humor] GET /joke → payment verified, settling...`);
  const settleResult = await httpServer.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
  );

  if (settleResult.success) {
    for (const [key, value] of Object.entries(settleResult.headers)) {
      res.setHeader(key, value);
    }
    console.log(`[humor] ← settle SUCCESS tx=${settleResult.transaction}`);
    res.json({
      setup: joke.setup,
      punchline: joke.punchline,
      paymentTx: settleResult.transaction,
    });
  } else {
    console.warn(`[humor] ← settle FAILED: ${settleResult.errorReason}`);
    res.status(402).json({ error: "Payment settlement failed", reason: settleResult.errorReason });
  }
});

async function start() {
  try {
    await httpServer.initialize();
    console.log("x402 HTTP resource server initialized");
  } catch (err) {
    console.warn("Warning: Could not initialize x402 server (facilitator may not be running yet):", (err as Error).message);
    console.warn("Server will start but payment processing may fail until facilitator is available.");
  }

  const server = app.listen(RESOURCE_PORT, () => {
    console.log(`
  Mezo x402 Humor Server
  ======================
  Port:        ${RESOURCE_PORT}
  Facilitator: ${FACILITATOR_URL}
  Payee:       ${PAYEE_ADDRESS}
  Network:     ${NETWORK}
  mUSD:        ${MUSD_ADDRESS}

  Endpoints:
    GET /       -- Service info (free)
    GET /joke   -- Setup free; pay 0.001 mUSD for punchline
    POST /add   -- Add a joke {setup, punchline} (free)
    GET /health -- Health check (free)
  `);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${RESOURCE_PORT} is already in use.`);
      console.error(`   Another humor server or service is running on that port.`);
      console.error(`   Kill it first: lsof -ti:${RESOURCE_PORT} | xargs kill\n`);
      process.exit(1);
    }
    throw err;
  });
}

start();
