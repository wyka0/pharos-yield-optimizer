/**
 * Deterministic formatting helpers shared by the optimizer, tx builder and UI.
 */

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });

const nf2 = nf(2, 2);

/** Money with fixed 2 decimals, thousands separators. */
export function money2(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return nf2.format(value);
}

/** Signed money: "+21.38" / "-2.82" / "0.00" (ASCII sign, bounty-sheet style). */
export function signedMoney2(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  const rounded = Math.round(value * 100) / 100;
  if (rounded > 0) return `+${money2(rounded)}`;
  if (rounded < 0) return `-${money2(Math.abs(rounded))}`;
  return "0.00";
}

/** One-decimal days, e.g. "26.3" — or "∞". */
export function days1(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return nf(1, 1).format(value);
}

/** Basis points → "8.15%". */
export function bpsToPct(bps: number): string {
  return nf2.format(bps / 100);
}

/** Percent → "8.15%". */
export function pct(value: number): string {
  return nf2.format(value);
}

/** Raw 6-dec string → human number string. */
export function fmtRaw6(raw: string, maxFrac = 2): string {
  const n = Number(raw) / 1e6;
  return nf(0, maxFrac).format(n);
}

/** Raw 18-dec string → human number string. */
export function fmtRaw18(raw: string, maxFrac = 6): string {
  const n = Number(raw) / 1e18;
  return nf(0, maxFrac).format(n);
}

/** Shorten an address for inline display: 0x299Ce411…AC15C */
export function shortAddr(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

/** Truncate calldata for table display with middle ellipsis. */
export function shortCalldata(data: string, head = 22, tail = 8): string {
  if (data.length <= head + tail + 3) return data;
  return `${data.slice(0, 2 + head)}…${data.slice(-tail)}`;
}
