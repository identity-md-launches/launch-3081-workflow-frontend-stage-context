import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useConnectorClient,
} from "wagmi";
import { X, Wallet, ExternalLink, ChevronDown } from "lucide-react";
import { useApp } from "./state";
import { friendly, short } from "./domain";
import { getAddress } from "viem";

export function Modal({
  title,
  close,
  children,
  dismissible = true,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissible) close();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={!dismissible}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const coinbaseIcon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#2c5ff6"/><circle cx="14" cy="14" r="10" fill="white"/><rect x="10" y="10" width="8" height="8" rx="1" fill="#2c5ff6"/></svg>',
  );
export function WalletControl() {
  const { rt, walletOpen, setWalletOpen } = useApp();
  const a = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { disconnect } = useDisconnect();
  const { connectAsync, connectors, isPending, variables } = useConnect();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window as Window & { ethereum?: unknown }).ethereum &&
    !connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const listed = connectors
    .filter((c) => !(c.id === "injected" && (named || mobile)))
    .sort(
      (a, b) => Number(a.type !== "injected") - Number(b.type !== "injected"),
    );
  const links = [
    {
      name: "MetaMask",
      href: `https://link.metamask.io/dapp/${location.href.replace(/^https?:\/\//, "")}`,
      icon: "./wallets/metamask.svg",
    },
    {
      name: "Coinbase Wallet",
      href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}`,
      icon: coinbaseIcon,
    },
    {
      name: "Rabby",
      href: `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(location.href)}`,
      icon: "./wallets/rabby.svg",
    },
    {
      name: "Phantom",
      href: `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
      icon: "./wallets/phantom.svg",
    },
  ];
  async function switchChain() {
    setError("");
    setPending(true);
    try {
      const provider = (await a.connector?.getProvider()) as
        | { request: (args: any) => Promise<unknown> }
        | undefined;
      if (!provider)
        throw new Error("Reconnect your wallet to switch networks.");
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: rt.deployment.walletAddChain.chainId }],
        });
      } catch (e: any) {
        if (
          e.code === 4902 ||
          /unknown chain|unrecognized chain|not added/i.test(e.message ?? "")
        ) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [rt.deployment.walletAddChain],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: rt.deployment.walletAddChain.chainId }],
          });
        } else throw e;
      }
    } catch (e) {
      setError(friendly(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {a.isConnected && a.address ? (
        a.chainId !== rt.chain.id ? (
          <button
            className="primary wallet-main"
            onClick={() => void switchChain()}
            disabled={pending}
          >
            {pending ? "Switching…" : `Switch to ${rt.chain.name}`}
          </button>
        ) : (
          <button className="wallet-main" onClick={() => setAccountOpen(true)}>
            <span className="connected-dot" />
            {short(getAddress(a.address))}
            <ChevronDown size={15} />
          </button>
        )
      ) : (
        <button
          className="primary wallet-main"
          onClick={() => setWalletOpen(true)}
        >
          <Wallet size={16} />
          Connect wallet
        </button>
      )}
      {walletOpen && (
        <Modal title="Connect a wallet" close={() => setWalletOpen(false)}>
          <p className="muted">
            Your wallet holds your keys and signs each transaction.
          </p>
          <div className="wallet-list">
            {mobile &&
              links.map((l) => (
                <a className="wallet-row" key={l.name} href={l.href}>
                  <img src={l.icon} width="28" height="28" alt="" />
                  Open in {l.name}
                  <ExternalLink size={16} />
                </a>
              ))}
            {listed.map((c) => (
              <button
                className="wallet-row"
                key={c.uid}
                disabled={isPending}
                onClick={async () => {
                  setError("");
                  try {
                    await connectAsync({ connector: c });
                    setWalletOpen(false);
                  } catch (e) {
                    setError(friendly(e));
                  }
                }}
              >
                {c.icon ? (
                  <img src={c.icon} width="28" height="28" alt="" />
                ) : c.id === "coinbaseWalletSDK" ? (
                  <img src={coinbaseIcon} width="28" height="28" alt="" />
                ) : (
                  <Wallet size={28} />
                )}
                <span>
                  {c.id === "injected"
                    ? "Browser wallet"
                    : c.id === "coinbaseWalletSDK" && mobile
                      ? "Coinbase Smart Wallet"
                      : c.name}
                  {isPending && variables?.connector === c ? " · Opening…" : ""}
                </span>
              </button>
            ))}
          </div>
          <p className="caption muted">
            On a phone, open this page in your wallet’s browser. No
            WalletConnect relay is configured.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </Modal>
      )}
      {accountOpen && a.address && (
        <Modal title="Connected wallet" close={() => setAccountOpen(false)}>
          <p className="address">{getAddress(a.address)}</p>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(getAddress(a.address!));
                setCopied(true);
              } catch {
                setError(
                  "Copy is unavailable in this browser. Select the full address above.",
                );
              }
            }}
          >
            {copied ? "Address copied" : "Copy address"}
          </button>
          <p className="muted">
            {connectorClient?.chain?.name ?? rt.chain.name}
          </p>
          <a
            href={`${rt.deployment.network.explorer}/address/${a.address}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer <ExternalLink size={14} />
          </a>
          <button
            className="wide"
            onClick={() => {
              disconnect();
              setAccountOpen(false);
            }}
          >
            Disconnect wallet
          </button>
        </Modal>
      )}
      {error && !walletOpen && (
        <div className="wallet-error" role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label="Dismiss wallet error"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
export function TransactionDialog() {
  const { rt, tx, setTx } = useApp();
  if (!tx) return null;
  const waiting = ["simulating", "signing", "pending"].includes(tx.phase);
  return (
    <Modal
      title={tx.label}
      dismissible={!waiting}
      close={() => {
        if (!waiting) setTx(null);
      }}
    >
      <p>{tx.details}</p>
      <p className="caption muted">
        {rt.chain.name} · Network fees are paid separately in ETH.
      </p>
      <div className={`tx-state ${tx.phase}`} role="status">
        {
          {
            review: "Review the expected action before continuing.",
            simulating: "Checking the transaction against the contract…",
            signing: "Confirm this transaction in your wallet.",
            pending: "Transaction submitted. Waiting for confirmation…",
            confirmed: "Transaction confirmed.",
            error: "Transaction did not complete.",
          }[tx.phase]
        }
      </div>
      {tx.error && (
        <p className="error" role="alert">
          {tx.error}
        </p>
      )}
      {tx.hash && (
        <a
          className="break"
          href={`${rt.deployment.network.explorer}/tx/${tx.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction <ExternalLink size={14} />
        </a>
      )}
      {["review", "error"].includes(tx.phase) && (
        <button className="primary wide" onClick={() => void tx.submit()}>
          {tx.phase === "error" ? "Try again" : "Simulate & confirm"}
        </button>
      )}
      {tx.phase === "confirmed" && (
        <button className="primary wide" onClick={() => setTx(null)}>
          Done
        </button>
      )}
    </Modal>
  );
}
