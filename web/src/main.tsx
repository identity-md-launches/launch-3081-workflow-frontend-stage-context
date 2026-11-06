import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Sun,
  Moon,
  ArrowUpRight,
  RefreshCw,
  CheckCheck,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { loadRuntime, type Runtime } from "./config";
import { AppProvider, useApp } from "./state";
import { IndexProvider } from "./indexer";
import { MarketPage } from "./market";
import { Portfolio } from "./portfolio";
import { Leaderboard, Docs } from "./pages";
import { TokenPage } from "./token";
import { WalletControl, TransactionDialog } from "./wallet";
import { friendly } from "./domain";
import "./styles.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
function App() {
  const { data, busy, refresh, rt } = useApp();
  const [page, setPage] = useState(location.hash.slice(1) || "markets");
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const handler = () => {
      setPage(location.hash.slice(1) || "markets");
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", handler);
    return () => removeEventListener("hashchange", handler);
  }, []);
  function toggleTheme() {
    const lock = document.createElement("style");
    lock.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.append(lock);
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? "dark" : "light";
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => lock.remove());
    try {
      localStorage.setItem("pimd-theme", value ? "dark" : "light");
    } catch {
      /* Theme still works when local storage is unavailable. */
    }
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#markets" aria-label="pIMD home">
          <img src="./logo.svg" width="36" height="36" alt="" />
          <span>
            <b>(p)</b>IMD
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {[
            ["markets", "Markets"],
            ["portfolio", "Portfolio"],
            ["leaderboard", "Leaderboard"],
            ["token", "pIMD"],
            ["docs", "Docs"],
          ].map(([id, label]) => (
            <a
              className={page === id ? "active" : ""}
              href={`#${id}`}
              key={id}
              aria-current={page === id ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <span className="network-name">
            <svg width="12" height="19" viewBox="0 0 12 19" aria-hidden="true">
              <path
                d="M6 0L0 9l6 3 6-3L6 0zm0 13l-6-3 6 9 6-9-6 3z"
                fill="currentColor"
              />
            </svg>
            {rt.chain.name}
          </span>
          <button
            className="theme-button icon-button"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <WalletControl />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {data.error && (
          <div className="connection-warning" role="alert">
            <AlertCircle size={18} />
            <span>{data.error}</span>
            <button onClick={() => void refresh()} disabled={busy}>
              Retry connection
            </button>
          </div>
        )}
        {page === "portfolio" ? (
          <Portfolio />
        ) : page === "leaderboard" ? (
          <Leaderboard />
        ) : page === "token" ? (
          <TokenPage />
        ) : page === "docs" ? (
          <Docs />
        ) : (
          <MarketPage />
        )}
      </main>
      <footer>
        <a className="footer-brand" href="#markets">
          (p)IMD
        </a>
        <span>Probability, with a position.</span>
        <div className="footer-status">
          <span className={data.verified ? "live-dot" : "loading-dot"} />
          {data.verified
            ? `Ethereum · Block ${data.head}`
            : data.error
              ? "Connection unavailable"
              : "Connecting to Ethereum"}
          <button
            className="icon-button"
            disabled={busy}
            onClick={() => void refresh()}
            aria-label="Refresh contract state"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <a href="./imd-deployment.json">
          Deployment <ArrowUpRight size={13} />
        </a>
      </footer>
      <TransactionDialog />
    </>
  );
}
function Startup() {
  const [rt, setRt] = useState<Runtime>();
  const [error, setError] = useState("");
  useEffect(() => {
    void loadRuntime()
      .then(setRt)
      .catch((e) => setError(friendly(e)));
  }, []);
  if (!rt)
    return (
      <div className="startup">
        <img src="./logo.svg" width="52" height="52" alt="pIMD" />
        <h1>{error ? "Unable to load pIMD" : "Opening the market…"}</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Verifying the attested contract interfaces."}
        </p>
        {error && <button onClick={() => location.reload()}>Reload</button>}
      </div>
    );
  return (
    <WagmiProvider config={rt.wallets}>
      <QueryClientProvider client={queryClient}>
        <AppProvider rt={rt}>
          <IndexProvider>
            <App />
          </IndexProvider>
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Startup />
  </StrictMode>,
);
