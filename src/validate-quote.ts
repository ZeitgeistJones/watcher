/**
 * One-shot QuoterV2 validation vs known Aerodrome frontend ballpark.
 * Run: npx tsx src/validate-quote.ts
 */
import {
  createPublicClient,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { base } from "viem/chains";
import { clPoolAbi, erc20Abi, quoterV2Abi } from "./abis.js";

const RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";
const POOL = "0x9249F441005947831eaAF9135B319AD97BCD6Bdf" as const;
const CX = "0x000000000000012DeF132E61759048bE5b5C6033" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const QUOTER = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0" as const;
const FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A" as const;

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "tickSpacing", type: "int24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const poolExtraAbi = [
  ...clPoolAbi,
  {
    type: "function",
    name: "fee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function quote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  human: string,
  decimals: number,
  tickSpacing: number,
) {
  const amountIn = parseUnits(human, decimals);
  const { result } = await client.simulateContract({
    address: QUOTER,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: CX,
        tokenOut: WETH,
        amountIn,
        tickSpacing,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return {
    amountIn,
    amountOut: result[0],
    sqrtPriceX96After: result[1],
    initializedTicksCrossed: result[2],
    gasEstimate: result[3],
  };
}

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC, { timeout: 30_000 }),
  });

  const block = await client.getBlockNumber();
  const [slot0, liq, ts, t0, t1, fee, factory, dec, factoryPool] =
    await Promise.all([
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "slot0" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "liquidity" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "tickSpacing" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "token0" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "token1" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "fee" }),
      client.readContract({ address: POOL, abi: poolExtraAbi, functionName: "factory" }),
      client.readContract({ address: CX, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [CX, WETH, 200],
      }),
    ]);

  const tickSpacing = Number(ts);
  const decimals = Number(dec);

  console.log(
    JSON.stringify(
      {
        block: block.toString(),
        pool: POOL,
        factoryFromPool: factory,
        factoryExpected: FACTORY,
        factoryGetPool_ts200: factoryPool,
        poolMatchesFactory: factoryPool.toLowerCase() === POOL.toLowerCase(),
        token0: t0,
        token1: t1,
        cxIsToken0: t0.toLowerCase() === CX.toLowerCase(),
        wethIsToken1: t1.toLowerCase() === WETH.toLowerCase(),
        tickSpacing,
        feeBps: Number(fee) / 100,
        feeRaw: Number(fee),
        tick: Number(slot0[1]),
        sqrtPriceX96: slot0[0].toString(),
        liquidity: liq.toString(),
        cxDecimals: decimals,
        quoter: QUOTER,
        zeroForOne: CX.toLowerCase() < WETH.toLowerCase(),
      },
      null,
      2,
    ),
  );

  for (const human of ["5000", "11577.51"]) {
    try {
      const q = await quote(client, human, decimals, tickSpacing);
      console.log(
        JSON.stringify(
          {
            amountInHuman: human,
            amountInRaw: q.amountIn.toString(),
            amountOutRaw: q.amountOut.toString(),
            amountOutWeth: formatUnits(q.amountOut, 18),
            sqrtPriceX96After: q.sqrtPriceX96After.toString(),
            initializedTicksCrossed: Number(q.initializedTicksCrossed),
            gasEstimate: q.gasEstimate.toString(),
            aeroFrontendBallpark_5000: human === "5000" ? "~0.0181 WETH" : undefined,
          },
          null,
          2,
        ),
      );
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      console.error(`QUOTE FAIL ${human}:`, err.shortMessage ?? err.message);
    }
  }
}

main();
