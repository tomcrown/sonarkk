# Sonark Move Contracts — Product Disclosures

This document records the operational assumptions and risk disclosures for the Sonark Move contracts. These are not implementation details — they are constraints that operators and users must understand before deploying capital.

---

## 1. NAV keeper-trust assumption

**What the contract does:** `SonarkPortfolio` stores `nav_per_share` (1e9-scaled quote units per share). This value is set by the keeper via `update_nav`. The `withdraw` function uses this value to compute how much DUSDC to return for a given `PortfolioShare`.

**The trust assumption:** The contract does NOT verify the NAV on-chain. It trusts that the keeper computed it correctly from:

- `quote_balance` — read directly from the portfolio's `Balance<Quote>`
- LP value — read from the Predict shared object via gRPC/GraphQL (off-chain)
- Bettor position mark-to-market — read from Predict's settled/pending positions (off-chain)

**Implication:** If the keeper pushes a NAV that is too high, shareholders who withdraw first receive more than their fair share. If NAV is too low, they receive less. A malicious keeper could manipulate NAV.

**Mitigations in place:**

- The keeper key is a dedicated limited key, scoped to one portfolio via `PolicyCap`.
- `PolicyCap` carries a budget cap and expiry — the keeper cannot drain more than the configured budget in a single cycle.
- The owner can destroy the `PolicyCap` at any time to freeze keeper access immediately.
- `withdraw` (no PolicyCap) always works even if the keeper is offline — exit is keeper-independent.
- Phase 5 adds an on-chain audit log of NAV updates via events (`NavUpdated`).

**User takeaway:** Trust the keeper to compute NAV honestly. The keeper key must be kept secure and scoped to the minimum necessary budget. Sonark's Phase 4 keeper logs every NAV update with its inputs; the Phase 5 data layer makes these auditable.

---

## 2. Range position settlement SLA (strategies ⑤ ⑥ ⑦)

**What the contract does NOT have:** There is no `redeem_range_permissionless` entry point in this vault. Range positions (strategy ⑤ Range-Roll, ⑥ Vol-Targeted, ⑦ Vol-Arb) are held inside a `PredictManager` object that the keeper controls. Settlement of expired range positions requires the keeper to call `predict::redeem_range` (or `redeem_range_permissionless` on the Predict protocol itself, if the keeper is the owner of the `PredictManager`).

**The SLA:** If the keeper goes offline after a range position expires but before it is settled, the portfolio's capital remains locked in the Predict `PredictManager` until the keeper comes back online and calls settlement. Users can still call `withdraw` on the portfolio — they will receive DUSDC from `quote_balance` if any is available, but they cannot retrieve the portion of capital locked in unsettled range positions.

**Binary positions (`predict::mint`) are different:** Binary positions via `mint` are settled permissionlessly by `predict::redeem_permissionless` — any caller can settle expired binary positions. The keeper is not required for these.

**Range-specific risk disclosure (required by CLAUDE.md Rule 3):** Range-Roll (⑤) and Vol-Targeted Range (⑥) are **short-volatility strategies**. They are profitable in calm markets and lose in volatility spikes. The keeper settlement SLA creates an additional operational risk: range positions that expire in-the-money while the keeper is offline will not immediately credit the portfolio.

**Mitigation in Phase 4:** The keeper includes a dead-man monitoring script that alerts on missed settlement windows. The policy object's `expiry_ms` bounds the maximum time the keeper can be authorized, ensuring stale keys expire automatically.

---

## 3. Principal-Protected strategy (④) — testnet vs mainnet

**Testnet:** Principal stays physically in `quote_balance`. `MockLending` simulates yield via time-weighted accounting. No actual lending protocol is called.

**Mainnet:** The interface is identical — `enable_principal_protected` / `claim_yield_from_lending` / `withdraw_principal`. The swap point is a single function call substitution: replace `MockLending` with an IronBank adapter. Principal is then physically transferred to IronBank on `enable_principal_protected` and retrieved on `withdraw_principal`.

**Invariant in both cases:** `available_balance() = quote_balance - locked_principal - yield_accumulated`. The keeper cannot touch principal or accumulated yield for any other strategy. This is enforced at the Move level — `take_for_supply` and `take_for_bettor` both call `available_balance()`.

---

## 4. Honest labeling

- **House strategies (①②③④):** Revenue comes from the supply spread (house edge). The spread is structural — the house collects it regardless of BTC direction. However, the absolute yield depends on trader volume in the Predict pool. On testnet, there is no live trader flow; any APY projections are modeled on assumed volume.
- **Betting strategies (⑤⑥):** These are short-volatility views. They are profitable when realized BTC volatility stays below the implied vol at entry. They lose when BTC volatility spikes. The break-even point has near-zero safety margin at normal BTC vol (40–80% realized). **Never present these as reliable income strategies.**
- **Directional (⑧):** Not implemented as an automated strategy. Manual tool only.
