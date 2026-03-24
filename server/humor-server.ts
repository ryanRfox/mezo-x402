/**
 * Mezo x402 Humor Server — joke paywall demo.
 *
 * GET /joke  — setup is free; pay mUSD to unlock the punchline
 * POST /add  — add a new joke to the flat-file DB (free)
 *
 * Built on @x402/express paymentMiddleware following upstream patterns.
 * Usage: cp .env.example .env && npx tsx humor-server.ts
 */

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import dotenv from "dotenv";
import express from "express";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Network } from "@x402/core/types";

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

const app = express();
app.use(express.json());

// x402 payment middleware — mirrors upstream @x402/express pattern
app.use(
  paymentMiddleware(
    {
      "GET /joke": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          payTo: PAYEE_ADDRESS,
          price: {
            amount: "1000000000000000", // 0.001 mUSD (18 decimals)
            asset: MUSD_ADDRESS,
            extra: {
              name: "Mezo USD",
              version: "1",
              assetTransferMethod: "permit2",
              supportsEip2612: true,
            },
          },
          maxTimeoutSeconds: 300,
        },
        description: "Unlock the punchline",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register("eip155:*", new ExactEvmScheme()),
  ),
);

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

// Joke endpoint — paywalled by middleware, only reached after payment
app.get("/joke", (_req, res) => {
  const jokes = readJokes();
  if (jokes.length === 0) {
    res.status(503).json({ error: "No jokes in the database yet. POST /add to add one!" });
    return;
  }

  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  console.log(`[humor] GET /joke → paid (punchline: "${joke.punchline}")`);
  res.json({ setup: joke.setup, punchline: joke.punchline });
});

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
