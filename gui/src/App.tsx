import { useEffect, useRef } from "react";
import { useAccount, useBalance, useConnect, useDisconnect, useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { MUSD_ADDRESS, PERMIT2_ADDRESS, EXPLORER_URL, mezoTestnet } from "./config";
import { usePayForJoke } from "./usePayForJoke";
import { usePermit2Approval } from "./usePermit2Approval";

function WalletInfo() {
  const { address } = useAccount();

  const { data: btcBalance } = useBalance({
    address,
    chainId: mezoTestnet.id,
  });

  const { data: musdBalance } = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: mezoTestnet.id,
    query: { enabled: !!address },
  });

  const { data: musdDecimals } = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: mezoTestnet.id,
    query: { enabled: !!address },
  });

  const { data: permit2Allowance } = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, PERMIT2_ADDRESS] : undefined,
    chainId: mezoTestnet.id,
    query: { enabled: !!address },
  });

  const decimals = musdDecimals ?? 18;
  const formattedMusd = musdBalance !== undefined
    ? formatUnits(musdBalance, decimals)
    : "—";
  const formattedBtc = btcBalance
    ? `${Number(btcBalance.formatted).toFixed(6)} ${btcBalance.symbol}`
    : "—";
  const hasPermit2Approval = permit2Allowance !== undefined && permit2Allowance > 0n;

  return (
    <div className="wallet-info">
      <div className="info-row">
        <span className="label">Address</span>
        <a
          href={`${EXPLORER_URL}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="value address"
          data-testid="wallet-address"
        >
          {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "—"}
        </a>
      </div>
      <div className="info-row">
        <span className="label">BTC Balance</span>
        <span className="value">{formattedBtc}</span>
      </div>
      <div className="info-row">
        <span className="label">mUSD Balance</span>
        <span className="value">{formattedMusd} mUSD</span>
      </div>
      <div className="info-row">
        <span className="label">Permit2 Allowance</span>
        <span className={`value ${hasPermit2Approval ? "approved" : "not-approved"}`}>
          {permit2Allowance === undefined
            ? "—"
            : hasPermit2Approval
              ? "Approved"
              : "Not Approved"}
        </span>
      </div>
      {permit2Allowance !== undefined && !hasPermit2Approval && (
        <div className="warning">
          mUSD is not approved for Permit2. You will need to approve before making x402 payments.
        </div>
      )}
    </div>
  );
}

function JokeCard() {
  const { address } = useAccount();
  const { state, pay, reset } = usePayForJoke();
  const { needsApproval, approve, isPending: approving } = usePermit2Approval(address);

  if (needsApproval) {
    return (
      <div className="joke-card">
        <p className="approval-prompt">Permit2 needs approval to transfer mUSD on your behalf.</p>
        <button className="btn approve" onClick={approve} disabled={approving}>
          {approving ? "Approving..." : "Approve mUSD for Permit2"}
        </button>
      </div>
    );
  }

  return (
    <div className="joke-card">
      {state.status === "idle" && (
        <button className="btn pay" data-testid="pay-button" onClick={pay}>
          Pay 0.001 mUSD for a Joke
        </button>
      )}

      {state.status === "signing" && (
        <p className="status">Please sign in your wallet...</p>
      )}

      {state.status === "settling" && (
        <p className="status">Settling payment on Mezo...</p>
      )}

      {state.status === "success" && (
        <div className="joke-result" data-testid="joke-result">
          <p className="setup" data-testid="joke-setup">{state.joke.setup}</p>
          <p className="punchline" data-testid="joke-punchline">{state.joke.punchline}</p>
          <a
            href={`${EXPLORER_URL}/tx/${state.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
            data-testid="tx-hash"
          >
            {state.txHash}
          </a>
          <button className="btn another" onClick={reset}>Get another joke</button>
        </div>
      )}

      {state.status === "error" && (
        <div className="error" data-testid="error-message">
          <p>Error: {state.message}</p>
          <button className="btn retry" onClick={reset}>Try again</button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const autoConnectRef = useRef(false);

  // Auto-connect in test mode (VITE_TEST_MODE=true)
  useEffect(() => {
    if (
      import.meta.env.VITE_TEST_MODE === "true" &&
      !isConnected &&
      !autoConnectRef.current &&
      connectors.length > 0
    ) {
      autoConnectRef.current = true;
      const connector = connectors[0];
      if (connector) connect({ connector, chainId: mezoTestnet.id });
    }
  }, [isConnected, connectors, connect]);

  return (
    <div className="app">
      <header>
        <h1>Mezo x402 Demo</h1>
        {isConnected ? (
          <button onClick={() => disconnect()} className="btn disconnect">
            Disconnect
          </button>
        ) : (
          <div className="connectors">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => connect({ connector, chainId: mezoTestnet.id })}
                className="btn connect"
              >
                Connect {connector.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <main>
        {isConnected ? (
          <>
            <WalletInfo />
            <JokeCard />
          </>
        ) : (
          <p className="hint">Connect your wallet to get started.</p>
        )}
      </main>
    </div>
  );
}
