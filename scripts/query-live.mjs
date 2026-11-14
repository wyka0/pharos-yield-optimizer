// Live chain probe — read-only diagnostics (not part of the app).
import { createPublicClient, http, formatUnits, parseAbi } from "viem";

const RPC = "https://atlantic.dplabs-internal.com";
const WALLET = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C";
const SUSDC = "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b";
const VAULTS = {
  tbill: "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78",
  credit: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
  harbor: "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
};
const FIREWALL = "0x4bf82bc533befdafa0a0d2154842394b37a40ea1";

const abi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function baseApyBps() view returns (uint256)",
  "function effectiveApyBps() view returns (uint256)",
  "function entryFeeBps() view returns (uint256)",
  "function exitFeeBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function symbol() view returns (string)",
  "function kyaCollateralRatioBps() view returns (uint256)",
  "function utilizationBps() view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function whitelistedVault(address) view returns (bool)",
]);

const client = createPublicClient({ transport: http(RPC, { timeout: 10000 }) });

const block = await client.getBlockNumber();
const gas = await client.getGasPrice();
console.log("block:", block.toString(), "gasPrice wei:", gas.toString(), `(${Number(gas) / 1e9} gwei)`);

const walletBal = await client.getBalance({ address: WALLET });
console.log("wallet PHRS:", formatUnits(walletBal, 18), `(${WALLET})`);
const otherWallet = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C";
const otherBal = await client.getBalance({ address: otherWallet }).catch((e) => 0n);
console.log("alt wallet PHRS:", formatUnits(otherBal, 18), `(${otherWallet})`);

const susdcBal = await client.readContract({ address: SUSDC, abi, functionName: "balanceOf", args: [WALLET] });
console.log("wallet sUSDC:", formatUnits(susdcBal, 6));

for (const [id, addr] of Object.entries(VAULTS)) {
  const [totalAssets, totalSupply, baseApy, effApy, entryFee, exitFee, paused, symbol, userShares] =
    await Promise.all([
      client.readContract({ address: addr, abi, functionName: "totalAssets" }),
      client.readContract({ address: addr, abi, functionName: "totalSupply" }),
      client.readContract({ address: addr, abi, functionName: "baseApyBps" }),
      client.readContract({ address: addr, abi, functionName: "effectiveApyBps" }),
      client.readContract({ address: addr, abi, functionName: "entryFeeBps" }),
      client.readContract({ address: addr, abi, functionName: "exitFeeBps" }),
      client.readContract({ address: addr, abi, functionName: "paused" }),
      client.readContract({ address: addr, abi, functionName: "symbol" }),
      client.readContract({ address: addr, abi, functionName: "balanceOf", args: [WALLET] }),
    ]);
  const userAssets = await client.readContract({ address: addr, abi, functionName: "convertToAssets", args: [userShares] });
  console.log(`\n[${id}] ${symbol} @ ${addr}`);
  console.log("  totalAssets:", formatUnits(totalAssets, 6), " totalSupply:", formatUnits(totalSupply, 6));
  console.log("  baseApy:", baseApy.toString(), " effectiveApy:", effApy.toString(), " entry:", entryFee.toString(), " exit:", exitFee.toString(), " paused:", paused);
  console.log("  userShares:", formatUnits(userShares, 6), " => userAssets:", formatUnits(userAssets, 6));
}

// extras
const kya = await client.readContract({ address: VAULTS.tbill, abi, functionName: "kyaCollateralRatioBps" }).catch(() => "n/a");
const util = await client.readContract({ address: VAULTS.credit, abi, functionName: "utilizationBps" }).catch(() => "n/a");
console.log("\ntbill kyaCollateralRatioBps:", kya?.toString(), " credit utilizationBps:", util?.toString());

// firewall
for (const v of Object.values(VAULTS)) {
  const wl = await client.readContract({ address: FIREWALL, abi, functionName: "whitelistedVault", args: [v] }).catch((e) => `err: ${e.message?.slice(0, 80)}`);
  console.log("firewall whitelistedVault", v, ":", wl);
}

// previewDeposit 5000 sUSDC on credit (for minSharesOut sanity)
const pd = await client.readContract({ address: VAULTS.credit, abi, functionName: "previewDeposit", args: [5000000000n] }).catch((e) => `err: ${e.message?.slice(0, 80)}`);
console.log("credit previewDeposit(5000 sUSDC):", typeof pd === "bigint" ? formatUnits(pd, 6) : pd);
