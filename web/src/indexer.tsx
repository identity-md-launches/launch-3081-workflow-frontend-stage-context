import { createContext, useContext, useState, type ReactNode } from "react";
import { type Address } from "viem";
import { useApp } from "./state";
import { friendly } from "./domain";
type Index = {
  logs: any[];
  busy: boolean;
  error: string;
  progress: string;
  complete: boolean;
  load: () => Promise<void>;
  clear: () => void;
};
const Context = createContext<Index>(null!);
export const useIndex = () => useContext(Context);
export function IndexProvider({ children }: { children: ReactNode }) {
  const { rt, data } = useApp();
  const [logs, setLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(
    "History is read directly from Ethereum events.",
  );
  const [cursor, setCursor] = useState<bigint>();
  const [anchor, setAnchor] = useState<{ number: bigint; hash: string }>();
  const [complete, setComplete] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError("");
    setComplete(false);
    try {
      if (!data.verified)
        throw new Error(
          "Wait for contract verification, then retry the history scan.",
        );
      let start: bigint = cursor ?? 0n;
      if (anchor) {
        const block = await rt.client.getBlock({ blockNumber: anchor.number });
        if (block.hash !== anchor.hash) {
          setLogs([]);
          setCursor(undefined);
          setAnchor(undefined);
          throw new Error(
            "A chain reorganization changed the history anchor. Reload history from deployment.",
          );
        }
      }
      const head = await rt.client.getBlockNumber();
      const confirmed = head > 12n ? head - 12n : head;
      if (cursor === undefined) {
        setProgress("Finding the deployment block…");
        let low = 0n,
          high = confirmed;
        while (low + 1n < high) {
          const mid = (low + high) / 2n;
          const code = await rt.client.getCode({
            address: rt.contract("PimdMarkets").address,
            blockNumber: mid,
          });
          if (code && code !== "0x") high = mid;
          else low = mid;
        }
        start = high;
      }
      const collected: any[] = [];
      let range = 5000n;
      for (let chunk = 0; start <= confirmed && chunk < 80; chunk++) {
        const end: bigint =
          start + range - 1n < confirmed ? start + range - 1n : confirmed;
        setProgress(
          `Reading events: blocks ${start}–${end} (12 confirmations)…`,
        );
        let batch;
        try {
          batch = await rt.client.getContractEvents({
            ...rt.contract("PimdMarkets"),
            fromBlock: start,
            toBlock: end,
            strict: true,
          });
        } catch (e) {
          if (range > 100n) {
            range = range / 2n;
            chunk--;
            continue;
          }
          throw e;
        }
        collected.push(...batch);
        start = end + 1n;
      }
      const block = await rt.client.getBlock({ blockNumber: start - 1n });
      setAnchor({ number: block.number, hash: block.hash });
      setLogs((old) => {
        const unique = new Map(
          [...old, ...collected].map((l) => [
            `${l.transactionHash}:${l.logIndex}`,
            l,
          ]),
        );
        return [...unique.values()].sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? a.logIndex - b.logIndex
            : a.blockNumber < b.blockNumber
              ? -1
              : 1,
        );
      });
      setCursor(start);
      setComplete(start > confirmed);
      setProgress(
        start > confirmed
          ? `Complete through block ${confirmed} (12 confirmations).`
          : `Partial scan through block ${start - 1n}. Continue to include later history.`,
      );
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        logs,
        busy,
        error,
        progress,
        complete,
        load,
        clear: () => {
          setLogs([]);
          setCursor(undefined);
          setAnchor(undefined);
          setComplete(false);
          setProgress("History cleared. Reload from deployment.");
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export { ledger } from "./ledger";
