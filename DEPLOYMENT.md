# Deployment Configuration

Production deployment uses **Koyeb** for the facilitator and **Render** for the humor server (resource server). Both services expose `/health` endpoints for uptime monitoring.

---

## Koyeb — Facilitator

### Build Command

```
npm i -g pnpm@10.7.0 && pnpm install && pnpm --filter mezo-x402-sdk build
```

### Run Command

```
cd facilitator && npx tsx facilitator.ts
```

### Environment Variables

| Variable | Example | Description |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | `0x...` | Private key for the facilitator wallet (funded with mUSD for settlements) |
| `NETWORK` | `eip155:31611` | CAIP-2 chain identifier (`eip155:31611` for testnet) |
| `MEZO_RPC_URL` | `https://rpc.test.mezo.org` | Mezo RPC endpoint |
| `PROXY_ADDRESS` | `0x8dea1b08dc2e1D9b556450f736F19968F367A98d` | x402 Permit2 proxy contract address (deployed on Mezo Testnet) |
| `PERMIT2_ADDRESS` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Uniswap Permit2 contract (canonical across all chains) |
| `PORT` | `8000` | Listening port (Koyeb sets this automatically) |

### Health Check

- **Path:** `/health`
- **Port:** value of `PORT` env var (default `4022` if unset)

---

## Render — Humor Server

### Build Command

```
npm i -g pnpm@10.7.0 && pnpm install && pnpm --filter mezo-x402-sdk build
```

### Run Command

```
cd server && npx tsx humor-server.ts
```

### Environment Variables

| Variable | Example | Description |
|---|---|---|
| `FACILITATOR_URL` | `https://<koyeb-app>.koyeb.app` | URL of the deployed facilitator service |
| `PAYEE_ADDRESS` | `0x...` | Wallet address that receives payments |
| `NETWORK` | `eip155:31611` | CAIP-2 chain identifier (must match facilitator) |
| `MUSD_ADDRESS` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | mUSD token contract on Mezo Testnet |
| `PORT` | `10000` | Listening port (Render sets this automatically) |

### Health Check

- **Path:** `/health`
- **Port:** value of `PORT` env var (default `3000` if unset)

---

## UptimeRobot Monitoring

Create two HTTP(s) monitors:

### Facilitator Monitor

- **Friendly Name:** Mezo x402 Facilitator
- **URL:** `https://<koyeb-app>.koyeb.app/health`
- **Monitoring Interval:** 5 minutes
- **Monitor Type:** HTTP(s)
- **Expected Status:** 200

### Humor Server Monitor

- **Friendly Name:** Mezo Humor Server
- **URL:** `https://<render-app>.onrender.com/health`
- **Monitoring Interval:** 5 minutes
- **Monitor Type:** HTTP(s)
- **Expected Status:** 200

Both `/health` endpoints return `{ "status": "ok" }` with a 200 status code when the service is running.
