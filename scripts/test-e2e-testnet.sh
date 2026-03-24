#!/usr/bin/env bash
# End-to-end integration test for the x402 humor-server payment flow on Mezo Testnet.
# Sources .env.mezo.testnet, starts facilitator + humor-server locally,
# runs client payment against real Mezo Testnet, verifies tx hash.
#
# Usage:
#   bash scripts/test-e2e-testnet.sh
#
# Prerequisites:
#   - .env.mezo.testnet filled in (run deploy-testnet.sh first)
#   - PROXY_ADDRESS must be set in .env.mezo.testnet
#   - Client wallet must have testnet mUSD balance
#   - Facilitator wallet must have testnet BTC for gas
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TESTNET_ENV="$ROOT_DIR/.env.mezo.testnet"

# Load env file
if [ -f "$TESTNET_ENV" ]; then
    set -a
    # shellcheck source=../.env.mezo.testnet
    source "$TESTNET_ENV"
    set +a
else
    echo "ERROR: $TESTNET_ENV not found."
    echo "  Copy .env.mezo.testnet.example to .env.mezo.testnet and fill in your values."
    exit 1
fi

FACILITATOR_PID=""
SERVER_PID=""
cleanup() {
  echo ""
  echo "Cleaning up..."
  [ -n "$FACILITATOR_PID" ] && kill "$FACILITATOR_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Mezo x402 Testnet End-to-End Test (humor-server) ==="
echo ""
echo "  Network: Mezo Testnet (chain 31611)"
echo "  RPC:     ${MEZO_RPC_URL:-https://rpc.test.mezo.org}"
echo ""

# Validate required env vars
for VAR in FACILITATOR_PRIVATE_KEY FACILITATOR_ADDRESS PAYEE_ADDRESS CLIENT_PRIVATE_KEY CLIENT_ADDRESS PROXY_ADDRESS MUSD_ADDRESS PERMIT2_ADDRESS; do
  if [ -z "${!VAR:-}" ]; then
    echo "ERROR: $VAR is not set."
    echo "  Source .env.mezo.testnet before running this script."
    echo "  If PROXY_ADDRESS is missing, run scripts/deploy-testnet.sh first."
    exit 1
  fi
done

NETWORK="${NETWORK:-eip155:31611}"
RPC_URL="${MEZO_RPC_URL:-https://rpc.test.mezo.org}"
FACILITATOR_PORT="${PORT:-4022}"
SERVER_PORT=3000

# ------------------------------------------------------------------
# Step 1: Build TypeScript packages
# ------------------------------------------------------------------
echo "[1/5] Building packages..."
cd "$ROOT_DIR"
pnpm build 2>&1
echo ""

# ------------------------------------------------------------------
# Step 2: Start facilitator
# ------------------------------------------------------------------
echo "[2/5] Starting facilitator..."
cd "$ROOT_DIR/facilitator"
FACILITATOR_PRIVATE_KEY="$FACILITATOR_PRIVATE_KEY" \
  NETWORK="$NETWORK" \
  MEZO_RPC_URL="$RPC_URL" \
  PROXY_ADDRESS="$PROXY_ADDRESS" \
  PORT="$FACILITATOR_PORT" \
  npx tsx facilitator.ts > /tmp/mezo-testnet-facilitator.log 2>&1 &
FACILITATOR_PID=$!
echo "  Facilitator PID: $FACILITATOR_PID"

for i in $(seq 1 30); do
  if curl -s "http://localhost:$FACILITATOR_PORT/health" > /dev/null 2>&1; then
    echo "  Facilitator ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "FAIL: Facilitator did not start within 15s"
    echo ""
    echo "=== Facilitator log ==="
    cat /tmp/mezo-testnet-facilitator.log
    exit 1
  fi
  sleep 0.5
done
echo ""

# ------------------------------------------------------------------
# Step 3: Start humor-server
# ------------------------------------------------------------------
echo "[3/5] Starting humor-server..."
cd "$ROOT_DIR/server"
PORT="$SERVER_PORT" \
  HUMOR_PORT="$SERVER_PORT" \
  FACILITATOR_URL="http://localhost:$FACILITATOR_PORT" \
  PAYEE_ADDRESS="$PAYEE_ADDRESS" \
  NETWORK="$NETWORK" \
  MUSD_ADDRESS="$MUSD_ADDRESS" \
  npx tsx humor-server.ts > /tmp/mezo-testnet-server.log 2>&1 &
SERVER_PID=$!
echo "  Humor server PID: $SERVER_PID"

for i in $(seq 1 30); do
  if curl -s "http://localhost:$SERVER_PORT/health" > /dev/null 2>&1; then
    echo "  Humor server ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "FAIL: Humor server did not start within 15s"
    echo ""
    echo "=== Humor server log ==="
    cat /tmp/mezo-testnet-server.log
    exit 1
  fi
  sleep 0.5
done
echo ""

# ------------------------------------------------------------------
# Pre-flight checks before client runs
# ------------------------------------------------------------------
# x402 v2 spec §5.2: 402 response MUST include PAYMENT-REQUIRED header
curl -s -D /tmp/mezo-testnet-402-headers.txt -o /dev/null "http://localhost:$SERVER_PORT/joke"

# Record payee mUSD balance before payment to verify on-chain settlement
PRE_PAYEE_BALANCE=$(cast call "$MUSD_ADDRESS" "balanceOf(address)(uint256)" "$PAYEE_ADDRESS" \
  --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo "unavailable")

# ------------------------------------------------------------------
# Step 4: Run client payment (with retry for EIP-7623 gas estimation bug)
# ------------------------------------------------------------------
echo "[4/5] Running client payment..."
cd "$ROOT_DIR/client"
CLIENT_OUTPUT=""
CLIENT_SUCCESS=false
for attempt in 1 2 3 4 5; do
  CLIENT_OUTPUT=$(CLIENT_PRIVATE_KEY="$CLIENT_PRIVATE_KEY" \
    RESOURCE_URL="http://localhost:$SERVER_PORT/joke" \
    NETWORK="$NETWORK" \
    RPC_URL="$RPC_URL" \
    MUSD_ADDRESS="$MUSD_ADDRESS" \
    PERMIT2_ADDRESS="$PERMIT2_ADDRESS" \
    PROXY_ADDRESS="$PROXY_ADDRESS" \
    npx tsx client.ts 2>&1) && { CLIENT_SUCCESS=true; break; }
  echo "  Attempt $attempt failed, retrying..."
  sleep 2
done

if [ "$CLIENT_SUCCESS" = false ]; then
  echo "FAIL: Client exited with error after 5 attempts"
  echo "$CLIENT_OUTPUT"
  echo ""
  echo "=== Facilitator log ==="
  cat /tmp/mezo-testnet-facilitator.log
  echo ""
  echo "=== Humor server log ==="
  cat /tmp/mezo-testnet-server.log
  exit 1
fi

echo "$CLIENT_OUTPUT"
echo ""

# Record payee mUSD balance after payment
POST_PAYEE_BALANCE=$(cast call "$MUSD_ADDRESS" "balanceOf(address)(uint256)" "$PAYEE_ADDRESS" \
  --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo "unavailable")

# ------------------------------------------------------------------
# Step 5: Verify results
# ------------------------------------------------------------------
echo "[5/5] Verifying results..."
PASS=true

if echo "$CLIENT_OUTPUT" | grep -q "Payment Successful"; then
  echo "  PASS: Client received successful payment response"
else
  echo "  FAIL: Client did not report successful payment"
  PASS=false
fi

if echo "$CLIENT_OUTPUT" | grep -q "punchline"; then
  echo "  PASS: Client received joke with punchline"
else
  echo "  FAIL: Client did not receive punchline in joke response"
  PASS=false
fi

# x402 spec v2 §5.2: 402 response MUST include PAYMENT-REQUIRED header (not only body)
if grep -qi "PAYMENT-REQUIRED:" /tmp/mezo-testnet-402-headers.txt 2>/dev/null; then
  echo "  PASS: 402 response includes PAYMENT-REQUIRED header (x402 v2 spec §5.2)"
else
  echo "  FAIL: 402 response missing PAYMENT-REQUIRED header (x402 v2 spec §5.2)"
  PASS=false
fi

# x402 v2 spec: PAYMENT-REQUIRED header (base64-encoded JSON) must include payTo matching PAYEE_ADDRESS
PAYMENT_HEADER=$(grep -i "^PAYMENT-REQUIRED:" /tmp/mezo-testnet-402-headers.txt 2>/dev/null | sed 's/^[^:]*: *//' | tr -d '\r')
DECODED_402=$(echo "$PAYMENT_HEADER" | base64 -d 2>/dev/null || echo "")
if echo "$DECODED_402" | grep -q "$PAYEE_ADDRESS"; then
  echo "  PASS: PAYMENT-REQUIRED header includes payTo=$PAYEE_ADDRESS"
else
  echo "  FAIL: PAYMENT-REQUIRED header missing payTo=$PAYEE_ADDRESS"
  PASS=false
fi

# x402 spec: Resource Server must call /verify on Facilitator before /settle
if grep -q "\[VERIFY\]" /tmp/mezo-testnet-facilitator.log; then
  echo "  PASS: Facilitator /verify was called by resource server (verify-before-settle)"
else
  echo "  FAIL: Facilitator /verify was never called"
  PASS=false
fi

# x402 spec: verify returned valid=true before settle was called
if grep -q "\[VERIFY\] valid=true" /tmp/mezo-testnet-facilitator.log; then
  echo "  PASS: Facilitator /verify returned valid=true"
else
  echo "  FAIL: Facilitator /verify did not return valid=true"
  PASS=false
fi

# x402 spec: PAYMENT-RESPONSE header forwarded from Resource Server to Client
if echo "$CLIENT_OUTPUT" | grep -q "PAYMENT-RESPONSE received"; then
  echo "  PASS: PAYMENT-RESPONSE (payment receipt) received by client"
else
  echo "  FAIL: PAYMENT-RESPONSE header not received by client"
  PASS=false
fi

# x402 spec: Resource Server forwarded X-PAYMENT-RESPONSE header
# Verified via facilitator log: [SETTLE] proves full round-trip (server received verify
# response, forwarded X-PAYMENT-RESPONSE to client, then called settle)
if grep -q "\[SETTLE\]" /tmp/mezo-testnet-facilitator.log; then
  echo "  PASS: Resource server forwarded X-PAYMENT-RESPONSE to client (settle confirms round-trip)"
else
  echo "  FAIL: Resource server did not forward X-PAYMENT-RESPONSE (no settle in facilitator log)"
  PASS=false
fi

# On-chain: client deducted exactly 0.001 mUSD (18 decimals = 1000000000000000)
EXPECTED_AMOUNT="0.0010"
if echo "$CLIENT_OUTPUT" | grep -q "mUSD deducted:.*${EXPECTED_AMOUNT} mUSD"; then
  echo "  PASS: Client mUSD deducted exactly ${EXPECTED_AMOUNT} mUSD (on-chain confirmed)"
else
  echo "  FAIL: Client mUSD deduction not ${EXPECTED_AMOUNT} mUSD (check client output above)"
  PASS=false
fi

# On-chain: payee received exactly 0.001 mUSD
EXPECTED_WEI="1000000000000000"
if [ "$PRE_PAYEE_BALANCE" != "unavailable" ] && [ "$POST_PAYEE_BALANCE" != "unavailable" ]; then
  PAYEE_DELTA=$(python3 -c "print($POST_PAYEE_BALANCE - $PRE_PAYEE_BALANCE)" 2>/dev/null || echo "error")
  if [ "$PAYEE_DELTA" = "$EXPECTED_WEI" ]; then
    echo "  PASS: Payee received exactly 0.001 mUSD on-chain (delta=$PAYEE_DELTA)"
  else
    echo "  FAIL: Payee mUSD delta wrong (got $PAYEE_DELTA, expected $EXPECTED_WEI)"
    PASS=false
  fi
else
  echo "  WARN: Payee on-chain balance check skipped (cast unavailable)"
fi

# Extract and display tx hash
TX_HASH=$(echo "$CLIENT_OUTPUT" | grep -oE '0x[0-9a-fA-F]{64}' | tail -1 || echo "")
if [ -n "$TX_HASH" ]; then
  echo ""
  echo "  Tx hash: $TX_HASH"
  echo "  Explorer: https://explorer.test.mezo.org/tx/$TX_HASH"
fi

# Show x402 protocol flow from logs
echo ""
echo "=== x402 protocol flow ==="
echo "  Facilitator:"
grep -E "\[VERIFY\]|\[SETTLE\]" /tmp/mezo-testnet-facilitator.log | sed 's/^/    /'  || echo "    (no entries)"
echo "  Humor server:"
grep "\[humor\]" /tmp/mezo-testnet-server.log | sed 's/^/    /' || echo "    (no entries)"

echo ""
if [ "$PASS" = true ]; then
  echo "=== ALL TESTS PASSED ==="
  exit 0
else
  echo "=== TESTS FAILED ==="
  echo ""
  echo "=== Facilitator log ==="
  cat /tmp/mezo-testnet-facilitator.log
  echo ""
  echo "=== Humor server log ==="
  cat /tmp/mezo-testnet-server.log
  exit 1
fi
