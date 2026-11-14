// Checksum + balance probe for the two candidate seeded wallets.
import { createPublicClient, http, formatUnits, getAddress, parseAbi } from "viem";

const RPC = "https://atlantic.dplabs-internal.com";
const SUSDC = "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b";
const VAULTS = {
  tbill: "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78",
  credit: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
  harbor: "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
};
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const client = createPublicClient({ transport: http(RPC, { timeout: 10000 }) });

const candidates = [
  "0x299Ce411d822B92594D77B14A8B239A84B2AC15C", // from the task sheet
  "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C", // from portfolio-assistant evidence
];

for (const raw of candidates) {
  let addr;
  try {
    addr = getAddress(raw);
  } catch (e) {
    // Recover checksum from lowercase
    addr = getAddress(raw.toLowerCase());
    console.log(`NOTE: ${raw} fails EIP-55 checksum; lowercase checksum = ${addr}`);
  }
  const phrs = await client.getBalance({ address: addr });
  const susdc = await client.readContract({ address: SUSDC, abi, functionName: "balanceOf", args: [addr] });
  const positions = [];
  for (const [id, v] of Object.entries(VAULTS)) {
    const shares = await client.readContract({ address: v, abi, functionName: "balanceOf", args: [addr] });
    positions.push(`${id}=${formatUnits(shares, 6)}`);
  }
  console.log(`${addr}\n  PHRS=${formatUnits(phrs, 18)} sUSDC=${formatUnits(susdc, 6)} ${positions.join(" ")}`);
}
