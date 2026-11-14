/**
 * Non-Custodial Airgap Audit (Requirement 04 enforcement).
 *
 * Scans every source file under src/ for ANY key-material, account-derivation
 * or raw-broadcast API. This project PREPARES unsigned transactions for the
 * user's own wallet to sign — it must be physically incapable of holding
 * keys or pushing raw signed payloads to a node:
 *   - no privateKeyToAccount / mnemonicToAccount / hdKeyToAccount
 *   - no generatePrivateKey / seed phrases / keystore JSON
 *   - no raw 32-byte hex literals (possible private keys)
 *   - no server-side raw broadcast calls
 *
 * Usage: npm run audit:noncustodial   (exit 1 = violation found)
 * The Vitest airgap test imports `scanForForbiddenPatterns` to keep the
 * test suite and this CLI audit in lockstep.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC_DIR = path.resolve(process.cwd(), "src");

/** Token substrings that must NEVER appear in src/. */
export const FORBIDDEN_TOKENS = [
  // viem / ethers account + key derivation surfaces
  "privateKeyToAccount",
  "mnemonicToAccount",
  "hdKeyToAccount",
  "generatePrivateKey",
  "keystore",
  "seedPhrase",
  // raw key material variable conventions
  "PRIVATE_KEY",
  "private_key",
  "privateKey",
  "mnemonic",
  // node-side raw broadcasting of signed payloads
  "sendRawTransaction",
  "sendRawTransactionSync",
  // signing APIs (signing happens in the USER's wallet, never here)
  "signTransaction",
  "signTypedData",
  "signMessage",
  "signAuthorization",
  "writeContract",
  "createWalletClient",
  "walletClient",
];

/** 32-byte hex strings (raw private keys) — e.g. 0x + 64 hex chars. */
const RAW_KEY_REGEX = /0x[0-9a-fA-F]{64}/;

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".json",
]);

export function listSourceFiles(dir = SRC_DIR, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full, base));
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry))) {
      out.push(path.relative(base, full).replaceAll("\\", "/"));
    }
  }
  return out.sort();
}

/** @returns {Array<{file: string, violation: string, line: number}>} */
export function scanForForbiddenPatterns(
  dir = SRC_DIR,
  readFile = (p) => readFileSync(p, "utf8"),
  files = listSourceFiles(dir),
) {
  const violations = [];
  for (const rel of files) {
    const full = path.join(dir, rel);
    let content;
    try {
      content = readFile(full);
    } catch {
      continue;
    }
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      for (const token of FORBIDDEN_TOKENS) {
        if (line.includes(token)) {
          violations.push({
            file: rel,
            violation: `forbidden token "${token}"`,
            line: idx + 1,
          });
        }
      }
      if (RAW_KEY_REGEX.test(line)) {
        violations.push({
          file: rel,
          violation: "raw 32-byte hex literal (possible private key)",
          line: idx + 1,
        });
      }
    });
  }
  return violations;
}

export function runAudit() {
  const violations = scanForForbiddenPatterns();
  const files = listSourceFiles(SRC_DIR);
  console.log("=".repeat(72));
  console.log(" NON-CUSTODIAL AIRGAP AUDIT — Pharos Apex Yield Optimizer");
  console.log("=".repeat(72));
  console.log(` Scanned ${files.length} source file(s) under src/`);
  for (const f of files) console.log(`   · ${f}`);
  console.log("-".repeat(72));
  console.log(
    " Checking for: key derivation (privateKeyToAccount, mnemonicToAccount,",
  );
  console.log(
    "               hdKeyToAccount), signing APIs, wallet clients, raw",
  );
  console.log(
    "               broadcast calls, raw 32-byte key literals...",
  );
  if (violations.length === 0) {
    console.log("");
    console.log(" ✓ PASS — zero key material, zero signing APIs, zero raw");
    console.log("   broadcast calls anywhere in src/. The agent only PREPARES");
    console.log("   unsigned EIP-155 payloads; the USER's wallet signs.");
    console.log("=".repeat(72));
    return 0;
  }
  console.log("");
  console.log(` ✗ FAIL — ${violations.length} violation(s):`);
  for (const v of violations) {
    console.log(`   · ${v.file}:${v.line} → ${v.violation}`);
  }
  console.log("=".repeat(72));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runAudit());
}
