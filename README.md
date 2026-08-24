# CX Watcher

Read-only Base watcher for one Aerodrome Slipstream CX/WETH pool.

It polls the pool, quotes your full CX bag via Aerodrome QuoterV2, and sends Telegram alerts when:

- the exit window opens/closes (tick vs `-115800` + active liquidity corroboration)
- the full-bag USD quote crosses configured tiers
- the large concentrated LP position is burned

**This is not a trading bot.** It never connects a wallet, never signs, never swaps, never approves.

## Official Quoter / contracts (verified source)

Addresses come from Aerodrome’s official Slipstream repo **Initial Deployment** table:

https://github.com/aerodrome-finance/slipstream/blob/main/README.md

| Contract | Address |
|----------|---------|
| QuoterV2 | `0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0` |
| NonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` |
| PoolFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` |

Pool watched: `0x9249F441005947831eaAF9135B319AD97BCD6Bdf`  
CX: `0x000000000000012DeF132E61759048bE5b5C6033`  
WETH: `0x4200000000000000000000000000000000000006`

Quotes use QuoterV2 `quoteExactInputSingle` with the pool’s on-chain `tickSpacing` (Slipstream uses tickSpacing, not Uniswap-style fee tiers).

Note: the “owner” on pool `Burn` events for this position is the NPM contract above, not a personal wallet.

When tick is **below** `-115800`, active liquidity collapses and a full-bag CX→WETH quote on **this pool alone** can be `0` WETH (selling CX moves price further away from the big LP range). That is expected. When the window opens, the same Quoter path should return a meaningful executable size.

## Setup

1. Copy env file:

   ```bash
   cp .env.example .env
   ```

2. Fill at least `BASE_RPC_URL` (any Base JSON-RPC works; default example uses `https://base.publicnode.com`).

3. Optional Telegram:

   - Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the bot token → `TELEGRAM_BOT_TOKEN`
   - Start a chat with your bot, then get your chat id (e.g. message [@userinfobot](https://t.me/userinfobot) or call `getUpdates` after messaging the bot) → `TELEGRAM_CHAT_ID`

4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

   One-shot status + quote (no loop):

   ```bash
   npm run once
   ```

   Production build:

   ```bash
   npm run build
   npm start
   ```

## Environment variables

See [`.env.example`](.env.example). Important knobs:

| Variable | Purpose |
|----------|---------|
| `BASE_RPC_URL` | Base RPC |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerts |
| `CX_AMOUNT` | Exact bag size to quote |
| `TICK_BOUNDARY` | Lower tick (`-115800`) |
| `BIG_LIQUIDITY_MIN` | Corroborate “big LP active” |
| `ALERT_*_USD` | Quote USD tiers |
| `POLL_INTERVAL_MS` | Default 30000 |
| `HEARTBEAT_INTERVAL_MS` | Default 6h |

Secrets stay in `.env` / host env — never commit them.

## How it works

Every poll (~30s):

1. Read pool `slot0` (tick), `liquidity()`, block number
2. Detect window open/close vs boundary + big-liquidity check
3. Quote `CX_AMOUNT` CX → WETH via QuoterV2
4. Convert to USD via CoinGecko (soft-fail; WETH quote always kept)
5. Scan recent `Burn` logs for NPM + exact tick range
6. Telegram only on state changes / tier upgrades / burns / heartbeat

Minimal state is stored in `data/state.json` to avoid spam after restarts.

## Railway (later)

This is a long-running worker. No HTTP server required.

- Start command: `npm run build && npm start` (or `npm run dev`)
- Set the same env vars in Railway
- Do not deploy until local quote validation looks right

## License

Private / personal use.
