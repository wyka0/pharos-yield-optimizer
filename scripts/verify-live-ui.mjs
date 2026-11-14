import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// Read-only production smoke test. No route interception, injected provider,
// invented receipt hash, wallet confirmation, or network transaction.
const baseUrl = process.argv[2] ?? "http://localhost:3200";
const output = path.resolve(process.argv[3] ?? "artifacts/verification/live-ui");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
try {
  const pendingSnapshot = page.waitForResponse((r) => r.url().includes("/api/optimizer-snapshot?"));
  const documentResponse = await page.goto(baseUrl);
  const snapshotResponse = await pendingSnapshot;
  const requested = await snapshotResponse.json();
  if (documentResponse.status() !== 200 || snapshotResponse.status() !== 200) throw Error("Page/API not HTTP 200");
  await page.getByTestId("live-verdict").waitFor();
  await page.screenshot({ path: path.join(output, "requested-desktop-light.png"), fullPage: true });
  const fundedResponse = page.waitForResponse((r) => r.url().includes("/api/optimizer-snapshot?") && r.url().toLowerCase().includes("299ce4113abf"));
  await page.getByTestId("inspect-funded-reference").click();
  const funded = await (await fundedResponse).json();
  await page.getByTestId("network-mode").filter({ hasText: "Live Funded Positions" }).waitFor();
  await fs.writeFile(path.join(output, "requested-snapshot.json"), JSON.stringify(requested, null, 2));
  await fs.writeFile(path.join(output, "funded-reference-snapshot.json"), JSON.stringify(funded, null, 2));
  await page.screenshot({ path: path.join(output, "funded-desktop-light.png") });
  const scenarios = [];
  for (const id of ["rebalance", "too-short", "already-optimal", "below-hurdle", "idle-deploy"]) {
    await page.getByTestId(`scenario-${id}`).click();
    const card = page.getByTestId("live-verdict");
    scenarios.push({ id, verdict: await card.getAttribute("data-verdict"), explanation: await card.innerText() });
  }
  const directSteps = await page.locator("#txbundle tbody tr").count();
  if (directSteps !== 2) throw Error(`Expected funded idle Direct approve/deposit; got ${directSteps}`);
  await page.getByTestId("route-guarded").click();
  if (!(await page.locator("#txbundle").innerText()).includes("requires a non-zero user-supplied receipt hash")) throw Error("Missing guarded receipt refusal");
  await page.getByTestId("route-direct").click();
  await page.getByRole("button", { name: "Sign with Wallet", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: path.join(output, "unsigned-review-drawer.png") });
  await page.getByRole("button", { name: "Close signing review" }).click();
  await page.locator("aside a[href='#comparison']").click();
  await page.screenshot({ path: path.join(output, "live-comparison.png") });
  await page.getByRole("button", { name: "Toggle light / dark theme" }).click();
  await page.screenshot({ path: path.join(output, "funded-desktop-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close navigation sidebar" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw Error("Mobile horizontal overflow");
  await page.screenshot({ path: path.join(output, "funded-mobile-dark.png"), fullPage: true });
  const report = { baseUrl, checkedAt: new Date().toISOString(), pageStatus: documentResponse.status(), apiStatus: snapshotResponse.status(), block: funded.blockNumber, cached: funded.fromCache, consoleErrors: errors, directSteps, guardedWithoutReceipt: "refused", mobileOverflow: overflow, scenarios };
  await fs.writeFile(path.join(output, "live-ui-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, scenarios: scenarios.map(({ id, verdict }) => ({ id, verdict })) }, null, 2));
  if (errors.length) throw Error(`Console errors: ${errors.length}`);
} finally {
  await browser.close();
}
