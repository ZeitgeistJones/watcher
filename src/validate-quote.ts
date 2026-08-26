/**
 * Validate production best-route quotes vs Aerodrome frontend.
 * Run: npm run validate:quote
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { loadConfigFromEnv } from "./config.js";
import { createRpcClient } from "./cycle.js";
import { quoteCxToWeth } from "./quote.js";

const KNOWN_5000_WETH = 0.018109334762314328;
const WETH_TOLERANCE = 0.000001;

async function main() {
  const cfg = loadConfigFromEnv(process.env);
  const client = createRpcClient(cfg.baseRpcUrl);
  const block = await createPublicClient({
    chain: base,
    transport: http(cfg.baseRpcUrl, { timeout: 60_000 }),
  }).getBlockNumber();

  console.log(JSON.stringify({ block: block.toString(), validation: "best-route" }, null, 2));

  let failed = false;

  for (const amount of ["5000", "11577.51"]) {
    try {
      const q = await quoteCxToWeth(client, cfg, amount);
      const weth = Number.parseFloat(q.wethFormatted);
      const row = {
        amountInHuman: amount,
        routeKind: q.routeKind,
        routePools: q.routePools,
        amountOutWeth: q.wethFormatted,
        candidateSummary: q.candidateSummary,
        mixedPathHex: q.mixedPathHex,
      };

      if (amount === "5000") {
        const delta = Math.abs(weth - KNOWN_5000_WETH);
        const ok = q.routeKind === "V2_VOLATILE" && delta <= WETH_TOLERANCE;
        console.log(
          JSON.stringify(
            {
              ...row,
              expectedWeth: KNOWN_5000_WETH,
              delta,
              matchesAerodromeFrontend: ok,
            },
            null,
            2,
          ),
        );
        if (!ok) failed = true;
      } else {
        console.log(JSON.stringify(row, null, 2));
        if (q.routeKind !== "V2_VOLATILE") {
          console.error(`Expected V2_VOLATILE for full bag, got ${q.routeKind}`);
          failed = true;
        }
      }
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      console.error(`QUOTE FAIL ${amount}:`, err.shortMessage ?? err.message);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, message: "Quotes match Aerodrome executable routes" }));
}

main();
