# Client

Payment client — requests an x402-protected resource, receives a 402, signs a Permit2 authorization for mUSD, and retries with the payment header to get the response.

## Setup

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Pre-filled? | Notes |
|----------|-------------|-------|
| `CLIENT_PRIVATE_KEY` | No | Private key for the paying wallet (needs testnet mUSD + BTC) |
| `RESOURCE_URL` | Yes | `http://localhost:3000/joke` |
| `NETWORK` | Yes | `eip155:31611` (Mezo Testnet) |
| `RPC_URL` | Yes | `https://rpc.test.mezo.org` |
| `MUSD_ADDRESS` | Yes | mUSD token on Mezo Testnet |
| `PERMIT2_ADDRESS` | Yes | Canonical Uniswap Permit2 |

## Run

```bash
npx tsx client.ts
```
