/**
 * Mezo x402 Facilitator — On-chain Leaderboard
 *
 * Reads mUSD Transfer events sent to the x402Permit2Proxy contract,
 * aggregates by payer address, and renders a Mezo-branded leaderboard.
 *
 * Routes:
 *   GET /leaderboard      — HTML leaderboard page
 *   GET /leaderboard/data — JSON API (same data, machine-readable)
 */

import type { Express } from "express";
import { type Address, createPublicClient, formatUnits, http, parseAbi } from "viem";

// ── Addresses ──────────────────────────────────────────────────────────
const X402_PROXY: Address = "0x402085c248eea27d92e8b30b2c58ed07f9e20001";
const MUSD_TESTNET: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const MUSD_MAINNET: Address = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186";

const ERC20_TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ── Constants ─────────────────────────────────────────────────────────
const START_BLOCK = 11830000n;
const CHUNK_SIZE = 10000n;
const CACHE_TTL_MS = 60_000;

// ── Cache ─────────────────────────────────────────────────────────────
let cachedData: LeaderboardData | null = null;
let cacheTimestamp = 0;

// ── Mezo chain definitions (matches facilitator.ts) ────────────────────
const mezoTestnet = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
} as const;

const mezoMainnet = {
  id: 31612,
  name: "Mezo Mainnet",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" } },
  testnet: false,
} as const;

// ── Data types ─────────────────────────────────────────────────────────
interface PayerStats {
  address: string;
  totalPaid: bigint;
  txCount: number;
}

interface LeaderboardData {
  payers: PayerStats[];
  totalSettlements: number;
  totalVolume: bigint;
  network: string;
  updatedAt: string;
}

// ── Chunked log fetching (Mezo RPC enforces 10k block max range) ──────
async function getTransferLogsChunked(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  latestBlock: bigint,
) {
  const event = ERC20_TRANSFER_ABI[0];
  const allLogs: Awaited<ReturnType<typeof client.getLogs<typeof event>>>= [];
  for (let from = START_BLOCK; from <= latestBlock; from += CHUNK_SIZE) {
    const to = from + CHUNK_SIZE - 1n > latestBlock ? latestBlock : from + CHUNK_SIZE - 1n;
    const chunk = await client.getLogs({
      address,
      event,
      fromBlock: from,
      toBlock: to,
    });
    allLogs.push(...chunk);
  }
  return allLogs;
}

// Get ALL logs from an address (no event filter) — used for proxy settlement events
async function getAllLogsChunked(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  latestBlock: bigint,
) {
  const allLogs: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (let from = START_BLOCK; from <= latestBlock; from += CHUNK_SIZE) {
    const to = from + CHUNK_SIZE - 1n > latestBlock ? latestBlock : from + CHUNK_SIZE - 1n;
    const chunk = await client.getLogs({
      address,
      fromBlock: from,
      toBlock: to,
    });
    allLogs.push(...chunk);
  }
  return allLogs;
}

// ── On-chain query ─────────────────────────────────────────────────────
async function fetchLeaderboardData(network: string, rpcUrl: string): Promise<LeaderboardData> {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData;
  }

  const isMainnet = network === "eip155:31612";
  const chain = isMainnet ? mezoMainnet : mezoTestnet;
  const musdAddress = isMainnet ? MUSD_MAINNET : MUSD_TESTNET;

  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const latestBlock = await client.getBlockNumber();

  // Step 1: Get all mUSD Transfer events in chunked ranges
  const transferLogs = await getTransferLogsChunked(client, musdAddress, latestBlock);

  // Step 2: Get ALL events from the proxy contract (not Transfer — proxy emits its own events)
  const proxyLogs = await getAllLogsChunked(client, X402_PROXY, latestBlock);

  // Build set of tx hashes from proxy interactions
  const proxyTxHashes = new Set<string>();
  for (const log of proxyLogs) {
    if (log.transactionHash) {
      proxyTxHashes.add(log.transactionHash);
    }
  }

  // Step 3: Match mUSD Transfer events to proxy settlement tx hashes
  const byPayer = new Map<string, PayerStats>();
  let settlementCount = 0;
  for (const log of transferLogs) {
    if (log.transactionHash && proxyTxHashes.has(log.transactionHash)) {
      const from = (log.args.from as string).toLowerCase();
      const value = log.args.value as bigint;
      const existing = byPayer.get(from);
      if (existing) {
        existing.totalPaid += value;
        existing.txCount++;
      } else {
        byPayer.set(from, { address: from, totalPaid: value, txCount: 1 });
      }
      settlementCount++;
    }
  }

  const payers = Array.from(byPayer.values()).sort((a, b) =>
    a.totalPaid > b.totalPaid ? -1 : a.totalPaid < b.totalPaid ? 1 : 0
  );

  const totalVolume = payers.reduce((sum, p) => sum + p.totalPaid, 0n);

  const data: LeaderboardData = {
    payers,
    totalSettlements: settlementCount,
    totalVolume,
    network: chain.name,
    updatedAt: new Date().toISOString(),
  };

  cachedData = data;
  cacheTimestamp = now;

  return data;
}

// ── HTML renderer ──────────────────────────────────────────────────────
function renderLeaderboard(data: LeaderboardData): string {
  const explorerBase = data.network === "Mezo Mainnet"
    ? "https://explorer.mezo.org"
    : "https://explorer.test.mezo.org";

  const rows = data.payers.map((p, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="address"><a href="${explorerBase}/address/${p.address}" target="_blank">${p.address.slice(0, 6)}...${p.address.slice(-4)}</a></td>
      <td class="amount">${formatUnits(p.totalPaid, 18)} mUSD</td>
      <td class="count">${p.txCount}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mezo x402 Leaderboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1a0a12 0%, #0a0a0a 100%);
      border-bottom: 1px solid #2a1520;
      padding: 24px 32px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .header-brand svg { width: 32px; height: 32px; }
    .header-brand h1 {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
    }
    .header-sub {
      font-size: 13px;
      color: #888;
      margin-left: 44px;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 20px;
    }
    .stat-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #ff004d; margin-top: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      overflow: hidden;
    }
    thead { background: #1a1a1a; }
    th {
      text-align: left;
      padding: 12px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      border-bottom: 1px solid #2a2a2a;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #1a1a1a;
      font-size: 14px;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: #1a1a1a; }
    .rank { color: #ff004d; font-weight: 700; width: 48px; }
    .address a { color: #ff6b8a; text-decoration: none; font-family: monospace; }
    .address a:hover { text-decoration: underline; }
    .amount { font-family: monospace; }
    .count { color: #888; }
    .footer {
      text-align: center;
      padding: 32px;
      font-size: 12px;
      color: #555;
    }
    .footer a { color: #ff004d; text-decoration: none; }
    .empty {
      text-align: center;
      padding: 48px;
      color: #555;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 400 222" fill="none">
        <path d="M114.94 142.08L146.44 110.58V110.44L177.79 141.94C186.85 151 197.93 155.03 208.86 155.03C231.73 155.03 253.73 137.2 253.73 110.44L285.08 141.94C294.14 151 305.22 155.03 316.15 155.03C339.02 155.03 361.02 137.2 361.02 110.44H334.12L302.77 79.09C293.71 70.03 282.49 66 271.56 66C248.69 66 226.83 83.69 226.83 110.44L195.48 79.09C186.42 70.03 175.2 66 164.27 66C141.4 66 119.54 83.69 119.54 110.44L39 110.58C39 137.48 61.29 154.88 84.16 154.88C95.09 154.88 106.17 150.85 114.94 142.08Z" fill="#FF004D"/>
      </svg>
      <h1>x402 Settlement Leaderboard</h1>
    </div>
    <div class="header-sub">${data.network} &middot; Updated ${new Date(data.updatedAt).toLocaleString()}</div>
  </div>
  <div class="container">
    <div class="stats">
      <div class="stat-card">
        <div class="label">Total Settlements</div>
        <div class="value">${data.totalSettlements}</div>
      </div>
      <div class="stat-card">
        <div class="label">Unique Payers</div>
        <div class="value">${data.payers.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Volume</div>
        <div class="value">${formatUnits(data.totalVolume, 18)} mUSD</div>
      </div>
    </div>
    ${data.payers.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Payer</th>
          <th>Total Paid</th>
          <th>Settlements</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : `<div class="empty">No settlements recorded yet.</div>`}
  </div>
  <div class="footer">
    Powered by <a href="https://mezo.org">Mezo</a> &middot;
    <a href="/leaderboard/data">JSON API</a>
  </div>
</body>
</html>`;
}

// ── Route registration ─────────────────────────────────────────────────
export function registerLeaderboard(app: Express, network: string, rpcUrl: string): void {
  app.get("/", (_req, res) => {
    res.redirect("/leaderboard");
  });

  app.get("/leaderboard", async (_req, res) => {
    try {
      const data = await fetchLeaderboardData(network, rpcUrl);
      res.type("html").send(renderLeaderboard(data));
    } catch (error) {
      console.error("[LEADERBOARD] Error:", error);
      res.status(500).send("Failed to load leaderboard");
    }
  });

  app.get("/leaderboard/data", async (_req, res) => {
    try {
      const data = await fetchLeaderboardData(network, rpcUrl);
      res.json({
        ...data,
        totalVolume: formatUnits(data.totalVolume, 18),
        payers: data.payers.map((p) => ({
          ...p,
          totalPaid: formatUnits(p.totalPaid, 18),
        })),
      });
    } catch (error) {
      console.error("[LEADERBOARD] Error:", error);
      res.status(500).json({ error: "Failed to load leaderboard data" });
    }
  });

  console.log("  GET  /leaderboard");
  console.log("  GET  /leaderboard/data");
}
