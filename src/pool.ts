// Pool reads + filtered Burn log scanning for the big CX/WETH position.

import { type Address, type PublicClient, parseAbiItem } from "viem";
import { clPoolAbi } from "./abis.js";

// Base (OP-stack) client types are stricter than default Chain; keep loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = PublicClient<any, any>;

const burnEvent = parseAbiItem(
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

export interface PoolSnapshot {
  blockNumber: bigint;
  tick: number;
  liquidity: bigint;
  tickSpacing: number;
  sqrtPriceX96: bigint;
}

export interface BurnHit {
  blockNumber: bigint;
  txHash: `0x${string}`;
  liquidityBurned: bigint;
  amount0: bigint;
  amount1: bigint;
}

export async function readPoolSnapshot(
  client: Rpc,
  pool: Address,
): Promise<PoolSnapshot> {
  // Sequential reads — friendlier to rate-limited public RPCs than Promise.all bursts.
  const slot0 = await client.readContract({
    address: pool,
    abi: clPoolAbi,
    functionName: "slot0",
  });
  const liquidity = await client.readContract({
    address: pool,
    abi: clPoolAbi,
    functionName: "liquidity",
  });
  const tickSpacing = await client.readContract({
    address: pool,
    abi: clPoolAbi,
    functionName: "tickSpacing",
  });
  const blockNumber = await client.getBlockNumber();

  return {
    blockNumber,
    tick: Number(slot0[1]),
    liquidity,
    tickSpacing: Number(tickSpacing),
    sqrtPriceX96: slot0[0],
  };
}

export async function findPositionBurns(
  client: Rpc,
  params: {
    pool: Address;
    npm: Address;
    tickLower: number;
    tickUpper: number;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<BurnHit[]> {
  if (params.toBlock < params.fromBlock) return [];

  const logs = await client.getLogs({
    address: params.pool,
    event: burnEvent,
    args: {
      owner: params.npm,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
    },
    fromBlock: params.fromBlock,
    toBlock: params.toBlock,
  });

  const hits: BurnHit[] = [];
  for (const log of logs) {
    if (!log.transactionHash || log.args.amount === undefined) continue;
    if (log.args.amount === 0n) continue;
    hits.push({
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash,
      liquidityBurned: log.args.amount,
      amount0: log.args.amount0 ?? 0n,
      amount1: log.args.amount1 ?? 0n,
    });
  }
  return hits;
}

/** Format large liquidity as scientific-ish string without Number precision loss. */
export function formatLiquidity(liq: bigint): string {
  const s = liq.toString();
  if (s.length <= 6) return s;
  const exp = s.length - 1;
  const mantissa = `${s[0]}.${s.slice(1, 5)}`;
  return `${mantissa}e${exp}`;
}

export function isBigLiquidityActive(liquidity: bigint, min: bigint): boolean {
  return liquidity >= min;
}

export function isWindowOpenByTick(tick: number, boundary: number): boolean {
  return tick >= boundary;
}
