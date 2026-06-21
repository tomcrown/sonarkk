# Sonark

**Automated strategy vaults for DeepBook Predict. Configure your own strategy or copy the best — the keeper handles everything else.**

[Live App →](https://sonark.vercel.app) · [Demo Video →]([DEMO_VIDEO_URL]) · [View on Suivision →](https://testnet.suivision.xyz/object/0x062dcd2484c1d9b1b32c26da60d3336c1aca854c5f15bacc81f29f6842a3d309)

---

## The problem

DeepBook Predict runs on sub-hour expiries. Positions don't sit there earning — they expire, settle, and need rolling every cycle, around the clock. Participating at any meaningful scale means either building keeper infrastructure yourself or managing every expiry manually — settling positions, rolling ranges, re-deploying capital — on a sub-hour cycle, around the clock.

And if you actually understand the vol surface and have edge — there is nowhere to publish your strategy, share a verified track record, or earn from other people copying you.

Sonark fixes both.

## What it does

Sign in with Google, pick a strategy, deposit dUSDC, and walk away. No wallet setup, no seed phrase, no watching expiries — the keeper handles every settlement cycle, supply, delta hedge, and roll automatically. You open the app when you feel like checking on it.

If you don't want to configure anything, the leaderboard shows every creator's full performance history — written to Walrus and independently verifiable by anyone with a URL, not just what Sonark reports. Find a track record you trust, pay a one-time copy fee, and run the same strategy under your own vault. Same keeper, your funds, your withdrawals.

If you have edge — a view on volatility, a calibrated parameter set, a strategy that works — Sonark gives you the infrastructure to publish it and get paid. Encrypt your configuration with Seal so copiers get access without seeing the logic, earn fees automatically, and build a verified track record on-chain. The copy trading marketplace for on-chain prediction strategies didn't exist. Now it does.

## How it uses Sui

**Move contracts — Vault, PolicyCap, Share Token**
Each portfolio is a Move object. The keeper's authority is bounded by an on-chain `PolicyCap` — a revocable capability that limits what it can spend and where. The owner can revoke it at any time, even if the keeper is running. Vault positions are minted as composable share tokens, not locked receipts.
`Package: 0x062dcd2484c1d9b1b32c26da60d3336c1aca854c5f15bacc81f29f6842a3d309`

**DeepBook Predict — 7 live strategies**
Every strategy runs directly against the Predict protocol. House strategies call `supply` to earn the vol spread as PLP. Bettor strategies call `mint_range` for short-vol positions. The keeper calls `redeem_permissionless` on settlement — users never need to manually redeem.
`Protocol: 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`

**DeepBook Spot — real delta hedging**
The Hedged PLP strategy places live orders on DeepBook Spot's BTC/USDC pool each cycle to offset the portfolio's net directional exposure. Not simulated — actual on-chain orders.
`Pool: 0x0dce0aa771074eb83d1f4a29d48be8248d4d2190976a5241f66b43ec18fa34de`

**DeepBook Margin + Lending — cross-protocol composability**
The Margin Loop strategy borrows against iron_bank positions to amplify Predict yield. The Principal Protected strategy parks principal in a lending pool and only deploys the accrued yield to Predict — principal never touches the prediction market.
`MockLending: 0xe8edb0f23cbcba583b4ccbd0f6b18c824bd2d145817ffa4e784cf5cbff5d23f0`

**Programmable Transaction Blocks**
Every keeper cycle is a single atomic PTB: settle the expired position, compute the next action, execute it, record the result. Nothing happens partially — if any step fails, nothing is committed.

**Seal — private strategy encryption**
Strategy creators can mark their vault private. The configuration is encrypted with Seal's threshold network under one access condition: the requester must hold a valid `CopyAccessTicket` on-chain. The key is split across a distributed network — no single server, including Sonark's, can decrypt it.
`Key server: 0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98`

**Walrus — verifiable performance history**
Daily leaderboard snapshots are written to Walrus as content-addressed blobs. The blob ID is anchored on-chain via a Sui registration transaction. Anyone can fetch the raw JSON directly from Walrus storage nodes and verify it without going through Sonark. The leaderboard banner links to the live blob.
`Latest snapshot: 5kp54YnnQ73o6phgXW13QNSL08PeJn1JiymmEJ8UNB8`
`Verify: https://aggregator.walrus-testnet.walrus.space/v1/blobs/5kp54YnnQ73o6phgXW13QNSL08PeJn1JiymmEJ8UNB8`

**zkLogin**
Sign in with Google. No wallet setup, no seed phrase, no browser extension. zkLogin handles the Sui account under the hood — making the full platform accessible to users who have never touched crypto.

## Strategies

| Strategy | Type | Risk | What the keeper automates |
|---|---|---|---|
| PLP Supplier | House | Low | Supply dUSDC each cycle, collect vol spread income |
| Hedged PLP | House | Low–Medium | PLP supply + live delta hedge on DeepBook Spot |
| Smart Vault | House | Low | Auto-allocates across house strategies per vol regime |
| Principal Protected | House | Very Low | Principal in lending; only yield enters Predict |
| Range Roll | Bettor | High | Mint range positions each expiry, auto-roll on settlement |
| Vol-Targeted Range | Bettor | Medium–High | Range Roll with SVI-based position sizing |
| Vol Arb | Bettor | High | Exploits spread between Predict implied vol and reference prices |

House strategies earn the spread and are structurally profitable across vol regimes. Bettor strategies are short-vol views — they perform in calm markets and are clearly labeled as such. No APY projections: performance history is on-chain and verifiable on Walrus.

## How to run it

**Prerequisites:** Node.js 20+, Sui CLI, a Supabase project, a testnet wallet with SUI for gas.

```bash
git clone https://github.com/tomcrown/sonarkk
cd sonark
npm install
cp .env.example .env
```

Fill in `.env` — the key fields:

```
KEEPER_PRIVATE_KEY=       # dedicated testnet keypair, not your main wallet
DATABASE_URL=             # Supabase Postgres connection string (port 6543)
DIRECT_URL=               # Supabase direct URL (port 5432, for migrations)
SONARK_PACKAGE=           # set after deploying contracts (step below)
```

Get dUSDC (required for Predict): https://tally.so/r/Xx102L

Deploy the Move contracts:

```bash
cd contracts/sonark
sui client publish --gas-budget 200000000
# copy the published package ID into SONARK_PACKAGE in .env
```

Run the database migrations:

```bash
npm run --workspace packages/core db:push
```

Set up the DeepBook BalanceManager (one-time, needed for delta hedging):

```bash
npm run --workspace packages/keeper setup
```

Start the API, keeper, and frontend:

```bash
# Terminal 1
npm run --workspace packages/api dev

# Terminal 2
npm run --workspace packages/keeper dev

# Terminal 3
npm run --workspace packages/frontend dev
```

Frontend: http://localhost:5173 · API: http://localhost:3001

## Built during Sui Overflow 2026 (May 7 – June 21)

Everything in this repository was built from scratch during the hackathon period:

- **Move contracts** — Vault, PolicyCap, Share Token, MockLending, MockMargin
- **Backtest engine** — replays real predict-server oracle data through the full spread and payoff model to evaluate each strategy
- **Strategy math** — net-delta calculator, SVI-based position sizing, hedge ratio logic, drawdown controls
- **Keeper** — autonomous polling loop, per-strategy execution, DeepBook Spot hedging, idempotent PTBs, Telegram notifications
- **Copy trading** — Seal encryption, Walrus blob storage, on-chain CopyAccessTicket gating, leaderboard with Walrus-verified performance
- **Full frontend** — dashboard, vol surface analytics, regime signals, copy trading marketplace, portfolio detail, AI strategy copilot, zkLogin

## On-chain addresses

```
Network:              Sui Testnet
Sonark Package:       0x062dcd2484c1d9b1b32c26da60d3336c1aca854c5f15bacc81f29f6842a3d309
Predict Package:      0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
Predict Object:       0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
MockLending:          0xe8edb0f23cbcba583b4ccbd0f6b18c824bd2d145817ffa4e784cf5cbff5d23f0
DeepBook Package:     0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c
DeepBook Registry:    0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1
Seal Key Server:      0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98
Walrus Snapshot:      5kp54YnnQ73o6phgXW13QNSL08PeJn1JiymmEJ8UNB8
```

## What's next

Mainnet on day one. DeepBook Predict's mainnet deployment is the trigger — Sonark's contracts, keeper, and copy trading marketplace are production-ready and redeploy without architectural changes. The first real creators publish verified track records. The copy trading economy goes from infrastructure to live.

Once real trader flow exists on-chain, the house strategy backtest switches from modeled volume to live data and the leaderboard becomes a genuine performance record, not a simulation. Cross-venue vol arb goes live with Polymarket and Hyperliquid price feeds connected as reference sources.

Longer term: share tokens become collateral in DeepBook Margin, and the Principal Protected strategy's lending leg connects to iron_bank on mainnet — completing the full three-protocol composability stack that the margin loop strategy is already built for.

## License

MIT

## Team

Tom Crown · [GitHub](https://github.com/tomcrown) · tomcrown317@gmail.com

Dennis · [GitHub](https://github.com/dennispaul8)
