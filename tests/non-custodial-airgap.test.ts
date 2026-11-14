/**
 * Non-Custodial Airgap Audit — Requirement 04 static enforcement.
 * Mirrors `npm run audit:noncustodial` (same scanner, same verdict) and
 * proves the scanner itself catches violations when they exist.
 */
import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_TOKENS,
  listSourceFiles,
  scanForForbiddenPatterns,
} from "../scripts/audit-noncustodial.mjs";

describe("non-custodial airgap audit (Requirement 04)", () => {
  it("src/ contains ZERO forbidden tokens or raw key literals", () => {
    const violations = scanForForbiddenPatterns();
    expect(violations).toEqual([]);
  });

  it("scans every source file under src/", () => {
    const files = listSourceFiles();
    expect(files.length).toBeGreaterThan(10);
    // the critical enforcement surfaces are all in scope
    expect(files).toContain("lib/optimizer/tx-builder.ts");
    expect(files).toContain("lib/optimizer/yield-optimizer.ts");
    expect(files).toContain("lib/onchain/snapshot-reader.ts");
    expect(files).toContain("app/page.tsx");
    for (const f of files) expect(f.startsWith("src/") === false).toBe(true);
  });

  it("requires the five rubric-mandated forbidden patterns", () => {
    for (const token of [
      "privateKeyToAccount",
      "mnemonicToAccount",
      "hdKeyToAccount",
      "sendRawTransaction",
      "signTransaction",
    ]) {
      expect(FORBIDDEN_TOKENS).toContain(token);
    }
  });

  it("catches key-derivation APIs when they appear (scanner self-test)", () => {
    const fakeFiles = ["evil.ts"];
    const fakeRead = (p: string) => {
      if (p.endsWith("evil.ts")) {
        return [
          'import { privateKeyToAccount } from "viem/accounts";',
          'const acct = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");',
          "client.sendRawTransaction({ signed: tx })",
        ].join("\n");
      }
      return "";
    };
    const violations = scanForForbiddenPatterns("/virtual", fakeRead, fakeFiles);
    const kinds = violations.map((v) => v.violation);
    expect(kinds).toContain('forbidden token "privateKeyToAccount"');
    expect(kinds).toContain("raw 32-byte hex literal (possible private key)");
    expect(kinds).toContain('forbidden token "sendRawTransaction"');
  });

  it("catches mnemonic and hd-key derivation APIs (scanner self-test)", () => {
    const fakeFiles = ["evil2.ts"];
    const fakeRead = (p: string) => {
      if (p.endsWith("evil2.ts")) {
        return [
          'import { mnemonicToAccount, hdKeyToAccount } from "viem/accounts";',
          'const a = mnemonicToAccount("words words words");',
          'const b = hdKeyToAccount({ privateKey: Uint8Array.from([1, 2, 3]) });',
        ].join("\n");
      }
      return "";
    };
    const violations = scanForForbiddenPatterns("/virtual2", fakeRead, fakeFiles);
    const kinds = violations.map((v) => v.violation);
    expect(kinds).toContain('forbidden token "mnemonicToAccount"');
    expect(kinds).toContain('forbidden token "hdKeyToAccount"');
  });

  it("flags every rubric token when present (scanner completeness)", () => {
    for (const token of FORBIDDEN_TOKENS) {
      const violations = scanForForbiddenPatterns(
        "/virtual3",
        () => `const x = "${token}";`,
        ["t.ts"],
      );
      expect(violations.some((v) => v.violation.includes(token))).toBe(true);
    }
  });
});
