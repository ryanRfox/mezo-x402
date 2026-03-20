# mezo-x402

Pay-per-request joke API on [Mezo Testnet](https://mezo.org) using the [x402 payment protocol](https://github.com/coinbase/x402). A client requests a joke, gets a `402 Payment Required` response, signs a Permit2 authorization for 0.001 mUSD, and retries — the server verifies payment, settles on-chain, and returns the punchline.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Humor Server
    participant F as Facilitator
    participant M as Mezo Testnet

    C->>S: GET /joke
    S-->>C: 402 + PaymentRequirements
    Note over C: Sign Permit2 EIP-712
    C->>S: GET /joke + PAYMENT-SIGNATURE
    S->>F: POST /verify
    F->>M: Read Permit2 allowance
    F-->>S: isValid: true
    S->>F: POST /settle
    F->>M: Permit2 transferFrom via x402Permit2Proxy
    F-->>S: tx hash
    S-->>C: 200 + joke + punchline + tx
```

## Quickstart

**Requirements:** Node.js 18+, pnpm, and funded Mezo testnet wallets.

```bash
git clone https://github.com/ryanRfox/mezo-x402.git
cd mezo-x402
pnpm install
pnpm --filter mezo-x402-sdk build
```

Copy `.env.example` to `.env` in each service directory and fill in your wallet keys:

```bash
cp facilitator/.env.example facilitator/.env
cp server/.env.example server/.env
cp client/.env.example client/.env
# Edit each .env file — add private keys and payee address
```

Then open three terminals:

**Terminal 1 — Facilitator** (verifies payments, settles on-chain)

```bash
cd facilitator && npx tsx facilitator.ts
# Listening on :4022
```

**Terminal 2 — Humor Server** (joke paywall)

```bash
cd server && npx tsx humor-server.ts
# Listening on :3000
```

**Terminal 3 — Client** (pays for a joke)

```bash
cd client && npx tsx client.ts
```

The client gets a 402, signs a Permit2 authorization, retries with the payment header, and receives the joke punchline along with the on-chain settlement transaction hash.

## Environment

The x402 flow uses three wallets:

| Wallet | Purpose | Funding needed |
|--------|---------|----------------|
| **Facilitator** | Submits `settle()` transactions | Testnet BTC (gas) |
| **Payee** | Receives mUSD payments | None |
| **Client** | Signs Permit2 authorizations | Testnet mUSD + BTC (Permit2 approval) |

Get testnet funds from the [Mezo Discord](https://discord.gg/mezo) faucet channels.

Each service has its own `.env.example` — copy to `.env` and fill in wallet keys:

| Service | Key vars to fill in |
|---------|-------------------|
| `facilitator/.env` | `FACILITATOR_PRIVATE_KEY` |
| `server/.env` | `PAYEE_ADDRESS` |
| `client/.env` | `CLIENT_PRIVATE_KEY` |

Network addresses and contract addresses are pre-filled in the `.env.example` files. A monolithic `.env.mezo.testnet.example` is also available for deploy/test scripts.

## Project Structure

```
client/         Payment client (signs Permit2, retries with payment header)
server/         Humor server (joke paywall) and generic resource server
facilitator/    x402 facilitator (verify + settle endpoints)
sdk/            mezo-x402-sdk: Mezo chain definitions, mUSD config
patches/        Patched @x402/evm with PROXY_ADDRESS env override
scripts/        E2E test scripts (anvil + testnet)
```

See each component directory (`facilitator/`, `server/`, `client/`) for per-service setup details and environment variable reference.

## Contract Addresses (Mezo Testnet, chain 31611)

| Contract | Address |
|----------|---------|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| x402Permit2Proxy | `0x8dea1b08dc2e1D9b556450f736F19968F367A98d` |
| mUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |

## Known Issues

**EIP-7623 gas estimation:** Mezo's `eth_estimateGas` omits the EIP-7623 calldata floor, causing Permit2 `settle()` to fail. The facilitator applies a 3x gas multiplier as a workaround. Tracked upstream.

**Patched `@x402/evm`:** The proxy contract address is hardcoded in upstream `@x402/evm`. This project uses a patched tarball that reads `PROXY_ADDRESS` from the environment. The patch will be removed once Mezo's proxy is deployed at the canonical CREATE2 address.
