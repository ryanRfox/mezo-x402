import { useEffect, useRef, useState } from "react";
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
    : "\u2014";
  const formattedBtc = btcBalance
    ? `${Number(btcBalance.formatted).toFixed(6)} ${btcBalance.symbol}`
    : "\u2014";
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
          {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "\u2014"}
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
            ? "\u2014"
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
          <span className="pay-label">Unlock the Punchline</span>
          <span className="pay-price">0.001 mUSD</span>
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
  const { isConnected, address } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const autoConnectRef = useRef(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

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

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <div className="app">
      <header>
        <div className="header-brand">
          <img src="/brand/mezo-logo.svg" alt="Mezo" width={32} height={32} />
          <span>Mezo x402 Humor Server</span>
        </div>
        {isConnected ? (
          <button onClick={() => disconnect()} className="btn disconnect">
            {truncatedAddress}
          </button>
        ) : (
          <button
            onClick={() => setShowWalletModal(true)}
            className="btn connect"
          >
            Connect Wallet
          </button>
        )}
      </header>

      <main>
        {isConnected ? (
          <>
            <WalletInfo />
            <JokeCard />
          </>
        ) : (
          <div className="hero">
            <h1 className="hero-headline">Pay-Per-Punchline</h1>
            <p className="hero-tagline">The setup is free. The punchline costs 0.001 mUSD.</p>
            <p className="hero-explainer">
              This demo showcases x402 — the HTTP payment protocol. Connect your wallet,
              pay a fraction of a cent in mUSD on Mezo, and unlock a bitcoin joke.
              Each payment settles on-chain via Permit2.
            </p>
            <button
              className="btn pay hero-cta"
              onClick={() => setShowWalletModal(true)}
            >
              Connect Wallet
            </button>
            <p className="hero-testnet">Mezo Testnet · No real funds required</p>
          </div>
        )}
      </main>

      {showWalletModal && (
        <div className="wallet-modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Connect a Wallet</h3>
            {connectors.filter((c) => c.name !== "Injected").map((connector) => (
              <button
                key={connector.uid}
                className="wallet-option"
                onClick={() => {
                  connect({ connector, chainId: mezoTestnet.id });
                  setShowWalletModal(false);
                }}
              >
                {connector.icon && (
                  <img src={connector.icon} alt={connector.name} />
                )}
                {connector.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
