"use client";

import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  Copy,
  Check,
  Wallet,
  Download,
  ExternalLink,
  FileJson,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PHAROS_CHAIN_ID } from "@/lib/contracts";
import type { OptimizerResult, OptimizerSnapshot, TxBundle, UnsignedTxStep } from "@/lib/optimizer/types";
import { money2, shortAddr, shortCalldata } from "@/lib/format";

/**
 * Requirement 04 — Non-Custodial Unsigned Transaction Bundle.
 * The agent PREPARES; only the user's own wallet signs. Zero key material
 * exists anywhere in this project (audited statically).
 */
export function TxBundle({
  result,
  snapshot,
  bundle,
  walletAddress,
  includeFirewall,
   onToggleFirewall,
   receiptHash,
   onReceiptHashChange,
}: {
  result: OptimizerResult;
  snapshot: OptimizerSnapshot;
  bundle: TxBundle | null;
  walletAddress: string;
  includeFirewall: boolean;
   onToggleFirewall: (include: boolean) => void;
   receiptHash: string;
   onReceiptHashChange: (hash: string) => void;
}) {
  const [signingStep, setSigningStep] = useState<UnsignedTxStep | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [signState, setSignState] = useState<
    { step: number; status: "pending" | "ok" | "error"; detail?: string }[]
   >([]);
   const [pending, setPending] = useState(false);
   const [modalError, setModalError] = useState<string | null>(null);
    const currentBundle = useRef(bundle);
    const drawerRef = useRef<HTMLDivElement>(null);
    currentBundle.current = bundle;
   // Any input/snapshot/route change invalidates step completion and review.
    useEffect(() => { setSigningStep(null); setSignState([]); setModalError(null); }, [bundle]);
    useEffect(() => {
      if (!signingStep) return;
      const previousFocus = document.activeElement as HTMLElement | null;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
      function onKey(event: KeyboardEvent) {
        if (event.key === "Escape" && !pending) setSigningStep(null);
        if (event.key !== "Tab") return;
        const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)") ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      document.addEventListener("keydown", onKey);
      return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
    }, [signingStep, pending]);

  function copy(text: string, tag: string) {
    void navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1600);
  }

  function downloadBundle() {
    if (!bundle) return;
    const payload = {
      meta: {
        generator: "Pharos Apex — Horizon-Aware Net-Yield Optimizer",
        route: bundle.route,
        chainId: PHAROS_CHAIN_ID,
        chainName: snapshot.chainName,
        rpcEndpoint: snapshot.rpcEndpoint,
        pinnedBlock: snapshot.blockNumber,
        verdict: result.verdict,
        netProceedsSusdc: bundle.netProceedsSusdc,
        preparedAt: new Date().toISOString(),
        requiredSender: walletAddress,
        unsigned: true,
        note: "Unsigned EIP-155-style payloads for USER wallet signature only. The agent never holds keys.",
      },
      steps: bundle.steps.map((s) => ({
        index: s.index,
        from: walletAddress,
        label: s.label,
        to: s.to,
        value: s.value,
        data: s.data,
        selector: s.selector,
        signature: s.signature,
        chainId: s.chainId,
        gasLimit: s.gasLimitHex,
        decodedArgs: s.decodedArgs,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-unsigned-bundle-block${snapshot.blockNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

   async function signWithWallet(step: UnsignedTxStep) {
     if (!bundle?.steps.some((s) => s.data === step.data && s.to === step.to) || result.verdict !== "REBALANCE_RECOMMENDED") return;
     setPending(true);
     const reviewedBundle = bundle;
     let submittedHash: string | null = null;
     setModalError(null);
    const eth = (window as unknown as {
      ethereum?: {
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      };
    }).ethereum;
     if (!eth) {
       setModalError("No injected wallet detected. Export the unsigned bundle and use your own wallet.");
       setPending(false);
      setSignState((s) => [
        ...s.filter((x) => x.step !== step.index),
        {
          step: step.index,
          status: "error",
          detail:
            "No injected wallet detected in this browser. Copy the unsigned bundle instead and sign it with your own wallet connected to Pharos Atlantic.",
        },
      ]);
      return;
    }
     setSigningStep(step);
     try {
       const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
       if (!accounts[0] || accounts[0].toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Connected account does not match the inspected owner. Inspect your own account and prepare again.");
       const chain = await eth.request({ method: "eth_chainId" });
       if (Number(BigInt(String(chain))) !== PHAROS_CHAIN_ID) throw new Error("Wrong network. Select Pharos Atlantic (688689) in your wallet before signing.");
       // Fail closed: each step must simulate on CURRENT state. Subsequent
       // steps remain disabled until the preceding transaction is confirmed.
       const transaction = { from: walletAddress, to: step.to, value: step.value, data: step.data, gas: step.gasLimitHex };
       await eth.request({ method: "eth_call", params: [transaction, "latest"] });
       if (currentBundle.current !== reviewedBundle) throw new Error("Inputs changed during wallet review. Prepare and review the current bundle again.");
       const txHash = await eth.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: walletAddress,
            to: step.to,
            value: step.value,
            data: step.data,
            gas: step.gasLimitHex,
            chainId: `0x${PHAROS_CHAIN_ID.toString(16)}`,
          },
        ],
       });
       if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) throw new Error("Wallet returned an invalid transaction hash.");
       submittedHash = String(txHash);
       if (currentBundle.current !== reviewedBundle) {
         window.alert(`A previously reviewed transaction was submitted: ${submittedHash}. Check its receipt before preparing another bundle.`);
         return;
       }
       setSignState((s) => [...s.filter((x) => x.step !== step.index), { step: step.index, status: "pending", detail: submittedHash! }]);
       const receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] }) as { status?: string } | null;
       setSignState((s) => [
         ...s.filter((x) => x.step !== step.index),
         { step: step.index, status: receipt?.status === "0x1" ? "ok" : "pending", detail: String(txHash) },
       ]);
       if (receipt?.status === "0x0") throw new Error("Transaction reverted; do not continue the bundle.");
       setSigningStep(null);
     } catch (err) {
       setModalError(err instanceof Error ? err.message : String(err));
       if (currentBundle.current !== reviewedBundle) return;
       if (submittedHash) {
         // Never enable resubmission merely because receipt retrieval failed.
         setSignState((s) => [...s.filter((x) => x.step !== step.index), { step: step.index, status: "pending", detail: submittedHash! }]);
         return;
       }
      setSignState((s) => [
        ...s.filter((x) => x.step !== step.index),
        {
          step: step.index,
          status: "error",
          detail: err instanceof Error ? err.message : String(err),
        },
      ]);
     } finally {
       setPending(false);
     }
   }

   async function checkConfirmation(step: number, hash: string) {
     const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
     if (!eth) return;
     try {
       const chain = await eth.request({ method: "eth_chainId" });
       if (Number(BigInt(String(chain))) !== PHAROS_CHAIN_ID) throw new Error("Select Pharos Atlantic to check the receipt.");
       const receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string } | null;
       if (receipt) setSignState((s) => s.map((x) => x.step === step ? { ...x, status: receipt.status === "0x1" ? "ok" : "error", detail: receipt.status === "0x1" ? hash : "Transaction reverted — stop this bundle." } : x));
     } catch (error) { setModalError(error instanceof Error ? error.message : String(error)); }
   }

  return (
    <div className="flex flex-col gap-4">
      {/* Airgap attestation banner */}
      <div className="flex items-start gap-3 rounded-lg border border-[var(--color-positive)]/40 bg-[var(--color-positive)]/10 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--color-positive)]" />
           <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Strictly Non-Custodial — Agent Never Holds Private Keys.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Transactions are prepared as unsigned EIP-155 payloads for user
            wallet signature only. Calldata is ABI-encoded with viem&apos;s{" "}
            <code className="font-mono text-[10px]">encodeFunctionData</code> at
             pinned block #{snapshot.blockNumber}. Payload amounts are fixed estimates;
             current-state simulation and confirmed receipts gate each user-initiated step.
             The optimizer holds no keys or server-side signers — statically attested by{" "}
            <code className="font-mono text-[10px]">npm run audit:noncustodial</code>.
          </p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-base font-medium">
              Unsigned Rebalance Bundle
            </CardTitle>
            <CardDescription>
              {bundle && bundle.steps.length > 0
                ? `${bundle.steps.length} step${bundle.steps.length === 1 ? "" : "s"} · ${money2(bundle.netProceedsSusdc)} sUSDC lands in ${result.best?.shortLabel ?? "target"} · chain ${PHAROS_CHAIN_ID} · every step value 0x0`
                : "No fund-moving steps are prepared for a STAY_PUT verdict — this section only fills when the optimizer recommends a rebalance."}
            </CardDescription>
             <div className="mt-3 flex flex-wrap gap-1 rounded-md bg-muted p-1">
               <Button data-testid="route-direct" size="sm" variant={includeFirewall ? "ghost" : "secondary"} aria-pressed={!includeFirewall} onClick={() => onToggleFirewall(false)}>Direct · redeem → approve → deposit</Button>
               <Button data-testid="route-guarded" size="sm" variant={includeFirewall ? "secondary" : "ghost"} aria-pressed={includeFirewall} onClick={() => onToggleFirewall(true)}>Policy-Guarded Firewall</Button>
             </div>
             <label className="mt-2 flex max-w-full cursor-pointer flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeFirewall}
                onChange={(e) => onToggleFirewall(e.target.checked)}
                className="size-3.5 accent-[var(--color-chart-orange)]"
              />
               Use alternative{" "}
               <code className="break-all font-mono text-[10px]">SentinelPolicyFirewall.executeGuardedAllocation</code>{" "}
              guarded route
             </label>
             {includeFirewall && <Input aria-label="Firewall receipt hash" className="mt-2 font-mono text-xs" placeholder="User-supplied non-zero receipt hash (0x… bytes32)" value={receiptHash} onChange={(e) => onReceiptHashChange(e.target.value)} />}
          </div>
          {bundle && bundle.steps.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(JSON.stringify(bundle.steps.map((s) => ({
                  from: walletAddress, to: s.to, value: s.value, data: s.data, gasLimit: s.gasLimitHex,
                  chainId: s.chainId,
                })), null, 2), "bundle")}
              >
                {copied === "bundle" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                Copy JSON
              </Button>
              <Button variant="outline" size="sm" onClick={downloadBundle}>
                <Download className="size-3.5" />
                Download .json
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {bundle && bundle.notes.length > 0 && bundle.steps.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-lg border border-border bg-background/50 p-3">
              {bundle.notes.map((n, i) => (
                <li key={i} className="text-[11px] leading-snug text-muted-foreground">
                  • {n}
                </li>
              ))}
            </ul>
          )}

          {bundle && bundle.steps.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Selector</TableHead>
                  <TableHead>Calldata (unsigned)</TableHead>
                  <TableHead className="text-right">Gas</TableHead>
                  <TableHead className="text-right">Sign</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundle.steps.map((s) => {
                  const state = signState.find((x) => x.step === s.index);
                  return (
                    <TableRow key={s.index}>
                      <TableCell className="font-mono text-xs">{s.index}</TableCell>
                      <TableCell>
                        <p className="text-xs font-medium">{s.label}</p>
                        <p className="max-w-[420px] text-[10px] leading-snug text-muted-foreground">
                          {s.description}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {s.signature}
                          {s.decodedArgs.map((a) => ` · ${a.name}=${a.value}`)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <a
                          className="font-mono text-[11px] underline-offset-2 hover:underline"
                          href={`${snapshot.explorerUrl}/address/${s.to}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortAddr(s.to)} <ExternalLink className="inline size-3" />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">{s.selector}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => copy(s.data, `data-${s.index}`)}
                          className="cursor-pointer text-left font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                          title="Click to copy full calldata"
                        >
                          {copied === `data-${s.index}` ? (
                            <span className="text-[var(--color-positive)]">copied ✓</span>
                          ) : (
                            shortCalldata(s.data)
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px]">
                        {s.gasUnits.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={state?.status === "ok" ? "secondary" : "default"}
                           onClick={() => { setModalError(null); setSigningStep(s); }}
                           disabled={pending || state?.status === "ok" || state?.status === "pending" || (s.index > 1 && signState.find((x) => x.step === s.index - 1)?.status !== "ok")}
                        >
                          <Wallet className="size-3.5" />
                          {state?.status === "ok"
                            ? "Sent ✓"
                            : signingStep?.index === s.index
                              ? "Waiting…"
                              : "Sign with Wallet"}
                         </Button>
                         {state?.status === "pending" && state.detail && <Button size="sm" variant="outline" onClick={() => void checkConfirmation(s.index, state.detail!)}>Check confirmation</Button>}
                        {state?.status === "ok" && (
                          <a
                            className="mt-1 block max-w-[140px] truncate font-mono text-[9px] text-[var(--color-positive)]"
                            href={`${snapshot.explorerUrl}/tx/${state.detail}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {state.detail}
                          </a>
                        )}
                        {state?.status === "error" && (
                          <p className="mt-1 max-w-[140px] truncate text-[9px] text-destructive" title={state.detail}>
                            {state.detail}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <FileJson className="mx-auto mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Bundle intentionally empty</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {bundle?.notes[0] ??
                  "Run a scenario that yields REBALANCE_RECOMMENDED to prepare an unsigned bundle."}{" "}
                 Live verdicts and available balances determine whether a bundle can be prepared.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sign modal / drawer */}
      {signingStep && (
         <div role="dialog" aria-modal="true" aria-label="Sign with Wallet (Non-Custodial)" className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-[2px]">
           <Card ref={drawerRef} className="h-full w-full max-w-xl overflow-y-auto rounded-none border-y-0 border-r-0 animate-in slide-in-from-right duration-200">
            <CardHeader className="flex-row items-start justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="size-4" />
                  Sign with Wallet (Non-Custodial)
                </CardTitle>
                <CardDescription>
                  Step {signingStep.index} · {signingStep.label}
                </CardDescription>
              </div>
               <Button aria-label="Close signing review" disabled={pending} variant="ghost" size="icon-sm" onClick={() => setSigningStep(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-background/50 p-3 font-mono text-[11px] leading-relaxed">
                <p><span className="text-muted-foreground">to</span>      {signingStep.to}</p>
                <p><span className="text-muted-foreground">value</span>   {signingStep.value}</p>
                <p><span className="text-muted-foreground">chainId</span> {signingStep.chainId} (Pharos Atlantic)</p>
                <p><span className="text-muted-foreground">gas</span>     {signingStep.gasLimitHex}</p>
                <p className="break-all"><span className="text-muted-foreground">data</span>     {signingStep.data}</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                 Review first; nothing is submitted until you confirm below. The payload is
                sent via your wallet&apos;s standard{" "}
                <code className="font-mono text-[10px]">eth_sendTransaction</code>{" "}
                RPC — the signature is produced INSIDE your wallet and the agent
                never touches it. Verify the contract address and selector{" "}
                <Badge variant="outline" className="font-mono text-[9px]">
                  {signingStep.selector}
                </Badge>{" "}
                before confirming.
               </p>
               {modalError && <p role="alert" className="text-xs text-destructive">{modalError}</p>}
               <Button disabled={pending} onClick={() => void signWithWallet(signingStep)}>{pending ? "Waiting for wallet…" : "Confirm in my wallet"}</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
