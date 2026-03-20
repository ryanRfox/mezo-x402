# Facilitator

x402 facilitator sidecar — verifies Permit2 payment signatures and settles them on-chain via the x402Permit2Proxy contract on Mezo Testnet.

## Setup

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Pre-filled? | Notes |
|----------|-------------|-------|
| `FACILITATOR_PRIVATE_KEY` | No | Private key for the facilitator wallet (needs testnet BTC for gas) |
| `NETWORK` | Yes | `eip155:31611` (Mezo Testnet) |
| `MEZO_RPC_URL` | Yes | `https://rpc.test.mezo.org` |
| `PROXY_ADDRESS` | Yes | x402Permit2Proxy on Mezo Testnet |
| `PERMIT2_ADDRESS` | Yes | Canonical Uniswap Permit2 |
| `PORT` | Yes | `4022` |

## Run

```bash
npx tsx facilitator.ts
# Listening on :4022
```
