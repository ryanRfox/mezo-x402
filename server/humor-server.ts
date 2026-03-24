/**
 * Mezo x402 Humor Server — joke paywall demo.
 *
 * Routes (root-level, matching upstream x402 Express patterns):
 *   GET  /joke   — setup is free; pay mUSD to unlock the punchline
 *   POST /add    — add a new joke to the flat-file DB (admin, free)
 *   POST /close  — graceful shutdown (admin, free)
 *   GET  /health — health check (free)
 *   GET  /info   — service info (free)
 *
 * Static files: serves gui/dist/ at root, with SPA fallback to index.html.
 *
 * Built on @x402/express paymentMiddleware following upstream patterns.
 * Usage: cp .env.example .env && npx tsx humor-server.ts
 */

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
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
const ADMIN_ENABLED = process.env.ENABLE_ADMIN !== "false";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JOKES_PATH = join(__dirname, "jokes.json");
const GUI_DIST = join(__dirname, "..", "gui", "dist");

interface Joke {
  setup: string;
  punchline: string;
}

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

async function readJokes(): Promise<Joke[]> {
  const data = await readFile(JOKES_PATH, "utf-8");
  return JSON.parse(data) as Joke[];
}

async function appendJoke(joke: Joke): Promise<void> {
  const jokes = await readJokes();
  jokes.push(joke);
  await writeFile(JOKES_PATH, JSON.stringify(jokes, null, 2) + "\n");
}

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const app = express();

// Open CORS for demo — restrict in production
app.use(cors({
  origin: "*",
  exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "PAYMENT-SIGNATURE"],
}));
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

// Service info (at /info to avoid collision with GUI index.html at /)
app.get("/info", async (_req, res) => {
  const jokes = await readJokes();
  res.json({
    service: "Mezo x402 Humor Server",
    description: "Pay mUSD to hear the punchline",
    network: NETWORK,
    jokeCount: jokes.length,
    endpoints: {
      "/info": "This info (free)",
      "/joke": "Random joke — setup free, punchline costs 0.001 mUSD",
      "/add": "POST {setup, punchline} to add a joke (admin, free)",
      "/health": "Health check (free)",
    },
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK, facilitator: FACILITATOR_URL });
});

// Admin endpoints — gated by ENABLE_ADMIN env var (default: enabled)
if (ADMIN_ENABLED) {
  // Add a joke (admin, free)
  app.post("/add", async (req, res) => {
    const { setup, punchline } = req.body as { setup?: string; punchline?: string };
    if (!setup || !punchline) {
      res.status(400).json({ error: "Both 'setup' and 'punchline' fields are required" });
      return;
    }
    const cleanSetup = stripHtmlTags(String(setup)).slice(0, 500);
    const cleanPunchline = stripHtmlTags(String(punchline)).slice(0, 500);
    if (!cleanSetup || !cleanPunchline) {
      res.status(400).json({ error: "Fields must not be empty after sanitization" });
      return;
    }
    await appendJoke({ setup: cleanSetup, punchline: cleanPunchline });
    const jokes = await readJokes();
    console.log(`[humor] POST /add → "${cleanSetup}" (total: ${jokes.length})`);
    res.status(201).json({ ok: true, total: jokes.length });
  });

  // Graceful shutdown (admin, free)
  app.post("/close", (_req, res) => {
    res.json({ message: "Humor server shutting down gracefully" });
    console.log("Received shutdown request");
    setTimeout(() => process.exit(0), 100);
  });
}

// Joke endpoint — paywalled by middleware, only reached after payment
app.get("/joke", async (_req, res) => {
  const jokes = await readJokes();
  if (jokes.length === 0) {
    res.status(503).json({ error: "No jokes in the database yet. POST /add to add one!" });
    return;
  }

  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  console.log(`[humor] GET /joke → paid (punchline: "${joke.punchline}")`);
  res.json({ setup: joke.setup, punchline: joke.punchline });
});

// --- Static files: serve gui/dist/ at root ---
if (existsSync(GUI_DIST)) {
  app.use(express.static(GUI_DIST));
  // SPA fallback: any route that doesn't match a static file or API route serves index.html
  app.get("*", (_req, res) => {
    res.sendFile(join(GUI_DIST, "index.html"));
  });
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
  Admin:       ${ADMIN_ENABLED ? "enabled" : "disabled"}
  GUI:         ${existsSync(GUI_DIST) ? GUI_DIST : "(not built — run pnpm --filter mezo-x402-gui build)"}

  Endpoints:
    GET  /info   -- Service info (free)
    GET  /joke   -- Setup free; pay 0.001 mUSD for punchline
    POST /add    -- Add a joke {setup, punchline} (admin, free)
    POST /close  -- Graceful shutdown (admin, free)
    GET  /health -- Health check (free)
    GET  /       -- GUI (static files from gui/dist/)
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
