# Humor Server

Joke paywall demo — serves joke setups for free and charges 0.001 mUSD via x402 to unlock the punchline. Delegates payment verification and settlement to the facilitator sidecar.

## Setup

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Pre-filled? | Notes |
|----------|-------------|-------|
| `PAYEE_ADDRESS` | No | Wallet address that receives mUSD payments |
| `HUMOR_PORT` | Yes | `3000` |
| `FACILITATOR_URL` | Yes | `http://localhost:4022` |
| `NETWORK` | Yes | `eip155:31611` (Mezo Testnet) |
| `MUSD_ADDRESS` | Yes | mUSD token on Mezo Testnet |
| `PROXY_ADDRESS` | Yes | x402Permit2Proxy on Mezo Testnet |

## Run

```bash
npx tsx humor-server.ts
# Listening on :3000
```
