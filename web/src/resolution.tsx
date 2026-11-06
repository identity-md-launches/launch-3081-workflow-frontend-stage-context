import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  erc20Abi,
} from "viem";
import { ShieldCheck, FileCheck2, ExternalLink } from "lucide-react";
import { useApp } from "./state";
import { buildBoundaryProof, importBoundaryProof, useProof } from "./proof";
import {
  amount,
  fmt,
  date,
  friendly,
  type Spec,
  type Asset,
  type Market,
} from "./domain";
import { ZERO } from "./config";
export function Resolution({
  spec,
  asset,
  market,
  startPrice,
  endPrice,
}: {
  spec: Spec;
  asset?: Asset;
  market?: Market;
  startPrice: bigint;
  endPrice: bigint;
}) {
  const { rt, data, send } = useApp();
  const account = useAccount();
  const [which, setWhich] = useState("start");
  const boundary = which === "end" ? (market?.end ?? 0n) : spec.start;
  const version = market?.version ?? asset?.version ?? 0;
  const witness = useProof(version, boundary);
  const [progress, setProgress] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState("");
  const [proposal, setProposal] = useState<any>();
  const [credit, setCredit] = useState(0n);
  const [cost, setCost] = useState<bigint>();
  const [proposed, setProposed] = useState("");
  const [firstBlock, setFirstBlock] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [allowance, setAllowance] = useState(0n);
  const [oldAsset, setOldAsset] = useState<Asset>();
  useEffect(() => {
    let cancelled = false;
    if (!version || !data.verified) return;
    void (async () => {
      try {
        const a = await rt.read("PimdRegistry", "asset", [version]);
        if (!cancelled && asset) setOldAsset({ ...asset, ...a, version });
        const id = keccak256(
          encodeAbiParameters(parseAbiParameters("uint32,uint64"), [
            version,
            boundary,
          ]),
        );
        const p = await rt.read("BoundaryOracle", "proposal", [id]);
        if (!cancelled) setProposal(p);
        try {
          const [, total] = await rt.read("BoundaryOracle", "oracleCost", [
            version,
          ]);
          if (!cancelled) setCost(total);
        } catch {
          if (!cancelled) setCost(undefined);
        }
        if (account.address) {
          const [c, a] = await Promise.all([
            rt.read("BoundaryOracle", "credit", [account.address]),
            rt.client.readContract({
              address: rt.deployment.network.pairToken.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account.address, rt.contract("BoundaryOracle").address],
            }),
          ]);
          if (!cancelled) {
            setCredit(c);
            setAllowance(a);
          }
        }
      } catch (e) {
        if (!cancelled) setError(friendly(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, boundary, account.address, rt, data, asset]);
  const now = data.timestamp;
  const recorded = which === "start" ? startPrice : endPrice;
  const proofOpen =
    boundary > 0n &&
    BigInt(now) >= boundary &&
    BigInt(now) <= boundary + 97200n;
  const liveProposal =
    proposal?.proposer && proposal.proposer !== ZERO && !proposal.finished;
  const challenger = proposal?.challenger && proposal.challenger !== ZERO;
  let maximum = 0n;
  try {
    if (maxCost) maximum = maxCost === "0" ? 0n : amount(maxCost, 18);
  } catch {
    /* shown when submitted */
  }
  const disabled =
    !data.verified || !account.isConnected || account.chainId !== rt.chain.id;
  function oracleAction(fn: string) {
    setError("");
    try {
      let args: any[] = [version, boundary];
      if (fn === "propose") {
        if (!/^\d+$/.test(firstBlock) || BigInt(firstBlock) === 0n)
          throw new Error("Enter the first block N of the boundary window.");
        args.push(amount(proposed, 18), BigInt(firstBlock));
      }
      if (fn === "dispute" || fn === "retryResolution") {
        if (!maxCost)
          throw new Error("Set a maximum oracle service cost in IMD.");
        maximum = maxCost === "0" ? 0n : amount(maxCost, 18);
        if (maximum > 10n ** 19n)
          throw new Error(
            "Maximum service cost cannot exceed the 10 IMD bond.",
          );
        args.push(maximum);
      }
      const names: Record<string, string> = {
        propose: "Propose boundary price",
        dispute: "Dispute price",
        retryResolution: "Retry oracle requests",
        finalize: "Finalize proposal",
        timeout: "Refund timed-out bonds",
      };
      send(
        "BoundaryOracle",
        fn,
        args,
        names[fn],
        `${names[fn]} for asset version ${version}, boundary ${date(boundary)} UTC. ${fn === "propose" ? "Locks a 10 IMD bond." : fn === "dispute" ? `Locks a 10 IMD bond and advances up to ${fmt(maximum, 18)} IMD in service fees.` : fn === "retryResolution" ? `Advance up to ${fmt(maximum, 18)} IMD in oracle fees; spent service fees may not be refunded.` : "This is a permissionless resolution transaction."}`,
      );
    } catch (e) {
      setError(friendly(e));
    }
  }
  async function build() {
    if (!oldAsset) return;
    setWorking(true);
    setError("");
    try {
      await buildBoundaryProof(rt, oldAsset, boundary, setProgress);
      setProgress(
        "Proof verified. Ready to record or attach to your next order or claim.",
      );
    } catch (e) {
      setError(friendly(e));
      setProgress("");
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="resolution">
      <div className="section-heading">
        <h3>
          <ShieldCheck size={17} />
          Boundary resolution
        </h3>
        <select
          aria-label="Boundary"
          value={which}
          onChange={(e) => {
            setWhich(e.target.value);
            setError("");
          }}
        >
          <option value="start">Start boundary</option>
          <option value="end" disabled={!market}>
            End boundary
          </option>
        </select>
      </div>
      <p className="caption muted">
        Version {version} · {date(boundary)} UTC ·{" "}
        {recorded ? `Recorded: $${fmt(recorded, 18, 6)}` : "Not recorded"}
      </p>
      <p className="caption">
        A proof uses Ethereum block headers and PoolManager storage proofs. The
        deployed verifier checks it before you sign.
      </p>
      <div className="button-row">
        <button
          onClick={() => void build()}
          disabled={!proofOpen || !oldAsset || working || !!recorded}
        >
          <FileCheck2 size={15} />
          {working ? "Building proof…" : "Build boundary proof"}
        </button>
        {witness && (
          <button
            className="primary"
            disabled={disabled || !!recorded}
            onClick={() =>
              send(
                "BoundaryOracle",
                "prove",
                [version, boundary, witness.proofs],
                "Record boundary proof",
                `Record the verified $${fmt(witness.price, 18, 6)} price at ${date(boundary)} UTC for all markets using this asset version.`,
              )
            }
          >
            Record proof
          </button>
        )}
      </div>
      {progress && (
        <p role="status" className="caption">
          {progress}
        </p>
      )}
      {!proofOpen && !recorded && (
        <p className="caption muted">
          Proofs are available from the boundary until 27 hours later, once N+2
          and a successor block exist.
        </p>
      )}
      <details>
        <summary>Import a proof witness</summary>
        <label>
          Witness JSON
          <textarea
            value={imported}
            onChange={(e) => setImported(e.target.value)}
            placeholder="Paste the build-proof.py witness JSON"
            rows={4}
          />
        </label>
        <button
          disabled={!oldAsset || working}
          onClick={async () => {
            setError("");
            setWorking(true);
            try {
              await importBoundaryProof(rt, oldAsset!, boundary, imported);
              setProgress("Imported proof verified by the deployed contract.");
            } catch (e) {
              setError(friendly(e));
            } finally {
              setWorking(false);
            }
          }}
        >
          Verify imported proof
        </button>
      </details>
      <details>
        <summary>Optimistic fallback & bonds</summary>
        <p className="caption">
          After 27 hours: propose with a 10 IMD bond. A challenge locks an equal
          bond and pays for oracle service. Unchallenged proposals finalize
          after 1 hour. A disputed proposal can time out at boundary + 3 days.
        </p>
        <dl className="data-list">
          <div>
            <dt>Proposal</dt>
            <dd>
              {liveProposal
                ? `$${fmt(proposal.proposed, 18, 6)}`
                : "None active"}
            </dd>
          </div>
          <div>
            <dt>Challenge deadline</dt>
            <dd>{liveProposal ? `${date(proposal.deadline)} UTC` : "–"}</dd>
          </div>
          <div>
            <dt>Service quote</dt>
            <dd>
              {cost !== undefined ? `${fmt(cost, 18)} IMD` : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Refund / reward credit</dt>
            <dd>{fmt(credit, 18)} IMD</dd>
          </div>
        </dl>
        <div className="form-grid">
          <label>
            Proposed USD price
            <input
              value={proposed}
              onChange={(e) => setProposed(e.target.value)}
              inputMode="decimal"
              placeholder="0.025"
            />
          </label>
          <label>
            First Ethereum block (N)
            <input
              value={firstBlock}
              onChange={(e) => setFirstBlock(e.target.value)}
              inputMode="numeric"
              placeholder="Boundary block"
            />
          </label>
          <label>
            Max oracle cost (IMD)
            <input
              value={maxCost}
              onChange={(e) => setMaxCost(e.target.value)}
              inputMode="decimal"
              placeholder={cost === undefined ? "Set a cap" : fmt(cost, 18)}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            disabled={disabled}
            onClick={() => {
              const n = 10n ** 19n + (maximum || 0n);
              send(
                `ERC20:${rt.deployment.network.pairToken.address}`,
                "approve",
                [rt.contract("BoundaryOracle").address, n],
                "Approve IMD bond",
                `Approve ${fmt(n, 18)} IMD to BoundaryOracle. The next transaction separately posts the bond or challenge.`,
              );
            }}
          >
            Approve bond{maximum ? " + service cap" : ""}
          </button>
          <button
            disabled={
              disabled ||
              allowance < 10n ** 19n ||
              !!recorded ||
              !!liveProposal ||
              BigInt(now) <= boundary + 97200n ||
              BigInt(now) + 3600n >= boundary + 259200n
            }
            onClick={() => oracleAction("propose")}
          >
            Propose price
          </button>
          <button
            disabled={
              disabled ||
              !liveProposal ||
              !!challenger ||
              proposal?.proposer?.toLowerCase() ===
                account.address?.toLowerCase() ||
              now >= Number(proposal?.deadline ?? 0) ||
              allowance < 10n ** 19n + maximum
            }
            onClick={() => oracleAction("dispute")}
          >
            Dispute
          </button>
          <button
            disabled={
              disabled ||
              !liveProposal ||
              !challenger ||
              proposal?.requested ||
              allowance < maximum
            }
            onClick={() => oracleAction("retryResolution")}
          >
            Retry resolution
          </button>
          <button
            disabled={
              disabled ||
              !liveProposal ||
              !!challenger ||
              now < Number(proposal?.deadline ?? 0)
            }
            onClick={() => oracleAction("finalize")}
          >
            Finalize
          </button>
          <button
            disabled={
              disabled ||
              !liveProposal ||
              !challenger ||
              BigInt(now) < boundary + 259200n
            }
            onClick={() => oracleAction("timeout")}
          >
            Refund timeout
          </button>
          <button
            disabled={disabled || credit === 0n}
            onClick={() =>
              send(
                "BoundaryOracle",
                "withdrawCredit",
                [],
                "Withdraw oracle credit",
                `Withdraw ${fmt(credit, 18)} IMD of oracle bond, refund or reward credit to your wallet.`,
              )
            }
          >
            Withdraw credit
          </button>
        </div>
      </details>
      {witness && (
        <p className="caption up-text">
          Verified proof is ready to attach to the next order or claim for this
          boundary.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <a
        className="caption"
        href={`${rt.deployment.network.explorer}/address/${rt.contract("BoundaryOracle").address}`}
        target="_blank"
        rel="noreferrer"
      >
        Inspect oracle <ExternalLink size={13} />
      </a>
    </div>
  );
}
