import { test, expect, type Page } from "@playwright/test";
import { deepLiquiditySnapshot, mockSnapshot } from "../tests/helpers/mock-snapshot";
import { SCENARIOS } from "../src/lib/optimizer/scenarios";

async function fixture(page: Page, snapshot = deepLiquiditySnapshot()) {
   // Synthetic reviewer routes need sufficient GROSS source shares. Explicitly
   // fund the fixture; never weaken the production balance guard for a preset.
   if (snapshot.vaults[0]?.totalAssetsSusdc === 1_000_000_000) {
     const harbor = snapshot.vaults.find((v) => v.id === "harbor")!;
     harbor.userShares = 6000; harbor.userSharesRaw = "6000000000"; harbor.userAssetsSusdc = 5999.999994;
   }
  await page.route("**/api/optimizer-snapshot?**", (route) => route.fulfill({ json: snapshot }));
  await page.goto("/");
  await expect(page.getByTestId("scenario-rebalance")).toBeVisible();
}
const verdict = (page: Page) => page.getByTestId("live-verdict");

async function scrollOffsetError(page: Page, id: string) {
  return page.locator(`#${id}`).evaluate((e) => Math.abs(e.getBoundingClientRect().top - parseFloat(getComputedStyle(e).scrollMarginTop)));
}

test("LIVE RPC: three pinned venues, requested wallet and provenance", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/optimizer-snapshot?"));
  await page.goto("/");
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  expect(snapshot.chainId).toBe(688689);
  expect(snapshot.wallet.address.toLowerCase()).toBe("0x299ce411d822b92594d77b14a8b239a84b2ac15c");
  expect(snapshot.vaults).toHaveLength(3);
  expect(snapshot.provenance.length).toBeGreaterThanOrEqual(30);
  expect(snapshot.vaults.every((v: { blockNumber: number }) => v.blockNumber === snapshot.blockNumber)).toBe(true);
  await expect(page.locator("#comparison tbody tr")).toHaveCount(3);
  await expect(page.locator("#txbundle")).toContainText("Bundle intentionally empty");
  for (const preset of SCENARIOS) {
    await page.getByTestId(`scenario-${preset.id}`).click();
    await expect(page.getByLabel("Source Position", { exact: true })).toHaveValue(preset.input.sourceVenue);
    await expect(page.getByLabel("Holding Horizon", { exact: true })).toHaveValue(String(preset.input.holdingPeriodDays));
    await expect(verdict(page)).toContainText(/STAY_PUT|REBALANCE_RECOMMENDED/);
  }
  expect(errors).toEqual([]);
  await testInfo.attach("live-snapshot", { body: JSON.stringify(snapshot, null, 2), contentType: "application/json" });
  await page.getByTestId("scenario-rebalance").click();
  await expect(page.getByTestId("network-mode")).toContainText("No Funded Positions");
  await expect(page.getByTestId("network-mode")).toContainText("Mainnet-Ready ABI Engine [0 Balance Required]");
  await page.screenshot({ path: "test-results/live-desktop-light.png", fullPage: true });
});

for (const preset of SCENARIOS) {
  test(`synthetic deep liquidity: scenario ${preset.id}`, async ({ page }) => {
    await fixture(page);
    await page.getByTestId(`scenario-${preset.id}`).click();
    await expect(verdict(page)).toHaveAttribute("data-verdict", preset.expected);
    await expect(page.getByLabel("Amount (sUSDC)", { exact: true })).toHaveValue(String(preset.input.amountSusdc));
    if (preset.expected === "STAY_PUT") {
      await expect(page.locator("#txbundle")).toContainText("Bundle intentionally empty");
      await expect(page.locator("#txbundle").getByRole("button", { name: "Sign with Wallet", exact: true })).toHaveCount(0);
    } else await expect(page.locator("#txbundle tbody tr")).toHaveCount(preset.id === "idle-deploy" ? 2 : 3);
  });
}

test("dilution alters verdict; controls and APY basis update immediately", async ({ page }) => {
  await fixture(page, mockSnapshot());
  await expect(verdict(page)).toContainText("STAY_PUT");
  await page.getByLabel("Source Position", { exact: true }).selectOption("wallet_idle");
  await page.getByLabel("Amount (sUSDC)", { exact: true }).fill("3000");
  await expect(verdict(page)).toContainText("REBALANCE_RECOMMENDED");
  const before = await page.locator("#comparison tbody").innerText();
  await page.getByRole("button", { name: "base APY", exact: true }).click();
  await expect(page.locator("#comparison tbody")).not.toHaveText(before);
  await page.getByLabel("Min Net Gain Hurdle", { exact: true }).fill("1000");
  await expect(verdict(page)).toContainText("NET_GAIN_BELOW_HURDLE");
});

test("charts render and all five links scroll with scroll-spy", async ({ page }) => {
  await fixture(page);
  await expect(page.locator("#comparison .recharts-surface").first()).toBeVisible();
  await expect(page.locator("#breakeven .recharts-line-curve")).toHaveCount(3);
  await expect(page.locator("#breakeven .recharts-reference-dot").first()).toBeAttached();
  for (const id of ["comparison", "breakeven", "txbundle", "provenance", "optimizer"]) {
    const link = page.locator(`aside a[href='#${id}']`);
    await link.click();
    await expect.poll(() => scrollOffsetError(page, id)).toBeLessThan(10);
    await expect(link).toHaveAttribute("aria-current", "location");
  }
  await page.getByRole("button", { name: "Toggle navigation sidebar" }).click();
  await expect(page.locator("aside")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle navigation sidebar" }).click();
  await expect(page.locator("aside")).toBeVisible();
});

test("theme persists and mobile drawer fits without horizontal overflow", async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("apex-theme")) localStorage.setItem("apex-theme", "dark"); });
  await fixture(page);
  await page.getByRole("button", { name: "Toggle light / dark theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({ path: "test-results/desktop-light.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close navigation sidebar" }).click();
  await expect(page.locator("aside")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation sidebar" }).click();
  await page.locator("aside a[href='#breakeven']").click();
  await expect(page.locator("aside")).toHaveCount(0);
  await expect.poll(() => scrollOffsetError(page, "breakeven")).toBeLessThan(10);
  await page.screenshot({ path: "test-results/mobile-light.png", fullPage: true });
});

test("export is unsigned; guarded route replaces direct deposit and requires receipt", async ({ page }) => {
  await fixture(page);
  await page.getByTestId("scenario-idle-deploy").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .json" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  expect(payload.meta.unsigned).toBe(true);
  expect(payload.meta.requiredSender).toBe(payload.steps[0].from);
  expect(payload.steps.map((s: { signature: string }) => s.signature)).toEqual(["approve(address,uint256)", "deposit(uint256,address)"]);
  expect(payload.steps.every((s: { chainId: number; value: string }) => s.chainId === 688689 && s.value === "0x0")).toBe(true);
  await page.locator("#txbundle input[type=checkbox]").check();
  await expect(page.locator("#txbundle")).toContainText("requires a non-zero user-supplied receipt hash");
  await page.getByLabel("Firewall receipt hash").fill(`0x${"1".repeat(64)}`);
  await expect(page.locator("#txbundle tbody tr")).toHaveCount(2);
  await expect(page.locator("#txbundle tbody")).toContainText("executeGuardedAllocation");
  await expect(page.locator("#txbundle tbody")).not.toContainText("deposit(uint256,address)");
});

test("signing review opens without sending and handles missing wallet", async ({ page }) => {
  await fixture(page);
  await page.getByTestId("scenario-idle-deploy").click();
  await page.getByRole("button", { name: "Sign with Wallet", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("nothing is submitted until you confirm");
  await expect(dialog.locator("[data-slot=card]")).toHaveCSS("height", `${page.viewportSize()!.height}px`);
  await dialog.getByRole("button", { name: "Confirm in my wallet" }).click();
  await expect(dialog.getByRole("alert")).toContainText("No injected wallet");
  await page.getByRole("button", { name: "Close signing review" }).click();
  await expect(dialog).toHaveCount(0);
});

test("apex design tokens and explicit funded-reference inspection", async ({ page }) => {
  await fixture(page);
  await expect(page.locator("aside")).toHaveCSS("position", "fixed");
  await expect(page.locator("aside")).toHaveCSS("width", "288px");
  await expect(page.locator("header")).toHaveCSS("position", "sticky");
  await expect(page.getByTestId("live-verdict")).toHaveCSS("border-radius", "8px");
  expect(await page.locator("body").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Inter");
  await page.getByTestId("inspect-funded-reference").click();
  await expect(page.getByTestId("network-mode")).toContainText("Live Funded Positions");
  await expect(page.getByTestId("network-mode")).toContainText("Reference wallet is not assumed yours");
  await page.getByTestId("route-guarded").click();
  await expect(page.locator("#txbundle input[type=checkbox]")).toBeChecked();
  await page.getByTestId("route-direct").click();
  await expect(page.locator("#txbundle input[type=checkbox]")).not.toBeChecked();
});

for (const failure of ["wrong account", "wrong chain", "simulation rejection"]) {
  test(`mock wallet preflight rejects ${failure} without submitting`, async ({ page }) => {
    await page.addInitScript(({ failure }) => {
      const calls: string[] = [];
      (window as unknown as { walletCalls: string[] }).walletCalls = calls;
      Object.defineProperty(window, "ethereum", { value: { request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === "eth_requestAccounts") return [failure === "wrong account" ? "0x0000000000000000000000000000000000000001" : "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C"];
        if (method === "eth_chainId") return failure === "wrong chain" ? "0x1" : `0x${(688689).toString(16)}`;
        if (method === "eth_call") throw new Error("Current-state simulation rejected");
        throw new Error("Unexpected wallet request");
      } } });
    }, { failure });
    await fixture(page); await page.getByTestId("scenario-idle-deploy").click();
    await page.getByRole("button", { name: "Sign with Wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Confirm in my wallet" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { walletCalls: string[] }).walletCalls)).not.toContain("eth_sendTransaction");
  });
}

test("mock confirmations gate step order; a new scenario invalidates review", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "ethereum", { value: { request: async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x299Ce4113abF88F4997737184aa8A7a3D58AC15C"];
      if (method === "eth_chainId") return `0x${(688689).toString(16)}`;
      if (method === "eth_call") return "0x";
      if (method === "eth_sendTransaction") return `0x${"2".repeat(64)}`; // Synthetic only; no network broadcast.
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw new Error("Unexpected request");
    } } });
  });
  await fixture(page); await page.getByTestId("scenario-idle-deploy").click();
  const buttons = page.locator("#txbundle tbody button").filter({ hasText: "Sign with Wallet" });
  await expect(buttons.nth(1)).toBeDisabled();
  await buttons.first().click(); await page.getByRole("button", { name: "Confirm in my wallet" }).click();
  await expect(page.getByRole("button", { name: "Sent ✓" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign with Wallet", exact: true })).toBeEnabled();
  await page.getByTestId("scenario-too-short").click();
  await expect(page.locator("#txbundle")).toContainText("Bundle intentionally empty");
});

test("wallet inspector validation and unavailable RPC empty state", async ({ page }) => {
  await fixture(page);
  await page.getByLabel("Wallet address to inspect").fill("not-an-address");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.locator("header")).toContainText("Invalid — expected");
  await page.unroute("**/api/optimizer-snapshot?**");
  await page.route("**/api/optimizer-snapshot?**", (route) => route.fulfill({ status: 503, json: { error: "Synthetic RPC unavailable" } }));
  await page.getByLabel("Wallet address to inspect").fill("0x0000000000000000000000000000000000000001");
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Unable to read/ })).toBeVisible();
  await expect(page.locator("main")).toContainText("Synthetic RPC unavailable");
  await expect(page.getByRole("button", { name: "Sign with Wallet", exact: true })).toHaveCount(0);
});

test("clipboard export and explicit refresh", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fixture(page);
  await page.getByTestId("scenario-idle-deploy").click();
  await page.getByRole("button", { name: "Copy JSON", exact: true }).click();
  const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(exported).toHaveLength(2);
  expect(exported[0].from).toBe("0x299Ce4113abF88F4997737184aa8A7a3D58AC15C");
  expect(exported[0].data).toMatch(/^0x095ea7b3/);
  const request = page.waitForRequest((r) => r.url().includes("/api/optimizer-snapshot?"));
  await page.getByRole("button", { name: "Re-read @ latest block", exact: true }).click();
  await request;
  await expect(page.getByRole("button", { name: "Re-read @ latest block", exact: true })).toBeEnabled();
});

test("a receipt-query failure retains pending hash and prevents duplicate submission", async ({ page }) => {
  await page.addInitScript(() => {
    let receiptCalls = 0;
    Object.defineProperty(window, "ethereum", { value: { request: async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x299Ce4113abF88F4997737184aa8A7a3D58AC15C"];
      if (method === "eth_chainId") return `0x${(688689).toString(16)}`;
      if (method === "eth_call") return "0x";
      if (method === "eth_sendTransaction") return `0x${"3".repeat(64)}`;
      if (method === "eth_getTransactionReceipt") { if (receiptCalls++ === 0) throw new Error("Synthetic receipt RPC outage"); return { status: "0x1" }; }
      throw new Error("Unexpected request");
    } } });
  });
  await fixture(page); await page.getByTestId("scenario-idle-deploy").click();
  await page.getByRole("button", { name: "Sign with Wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Confirm in my wallet" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("receipt RPC outage");
  await page.getByRole("button", { name: "Close signing review" }).click();
  await expect(page.getByRole("button", { name: "Sign with Wallet", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign with Wallet", exact: true }).nth(1)).toBeDisabled();
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect(page.getByRole("button", { name: "Sent ✓" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign with Wallet", exact: true })).toBeEnabled();
});
