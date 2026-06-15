/// SonarkPortfolio — per-user strategy portfolio on DeepBook Predict.
///
/// One portfolio per user. Holds capital and runs 1–7 strategy slots simultaneously.
/// A portfolio with one slot at 10000 bps (100%) is a single-strategy bot — valid.
///
/// Capital flow (keeper PTB orchestrates, vault manages custody):
///   deposit → quote_balance
///   keeper take_for_supply → [Predict supply] → store_lp (lp_balances)
///   keeper take_lp → [Predict withdraw] → store_quote (quote_balance)
///   keeper take_for_bettor → [PredictManager deposit + mint] → store_quote (settle)
///   user withdraw → share burned → Coin<Quote> returned
///
/// Strategy ④ Principal-Protected:
///   Principal is LOGICALLY locked in the portfolio (tracked via PrincipalState).
///   It never touches Predict — enforced at the Move level via available_balance().
///   Yield is simulated by MockLending and deployed separately as Predict bets.
module sonark::portfolio;

use sonark::{
    mock_lending::{MockLending, LendingReceipt, accrue_yield, preview_yield, admin_fast_forward_yield, new_receipt, reduce_principal, principal},
    mock_margin::{Self, MockMargin, MarginReceipt, borrow_capacity},
    policy::{Self, PolicyCap},
};
use std::type_name::{Self, TypeName};
use sui::{
    bag::{Self, Bag},
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
};

// === Constants ===

const MAX_STRATEGIES: u64 = 8; // 0–7 (added MARGIN_LOOP)
/// Share pricing uses 1e9 scaling: nav_per_share is quote units per 1e9 shares.
const SCALING: u64 = 1_000_000_000;
/// Keeper must update NAV within this window or new deposits are rejected.
const MAX_NAV_AGE_MS: u64 = 600_000; // 10 minutes

// Strategy kind identifiers
const STRATEGY_PLP_SUPPLIER:        u8 = 0;
const STRATEGY_HEDGED_PLP:          u8 = 1;
const STRATEGY_SMART_VAULT:         u8 = 2;
const STRATEGY_PRINCIPAL_PROTECTED: u8 = 3;
const STRATEGY_RANGE_ROLL:          u8 = 4;
const STRATEGY_VOL_TARGETED:        u8 = 5;
const STRATEGY_VOL_ARB:             u8 = 6;
const STRATEGY_MARGIN_LOOP:         u8 = 7;

// === Errors ===
const ENotOwner: u64 = 0;
const EInvalidAllocations: u64 = 1;
const ENavStale: u64 = 2;
const EZeroAmount: u64 = 3;
const EZeroShares: u64 = 4;
const EInsufficientBalance: u64 = 5;
const EInvalidStrategyKind: u64 = 6;
const ETooManyStrategies: u64 = 7;
const EVolOverrideTooLow: u64 = 8;
const EManagerAlreadySet: u64 = 9;
const EPortfolioPaused: u64 = 10;
const EInsufficientLpBalance: u64 = 11;
const EWrongPortfolio: u64 = 12;
const EPrincipalStateExists: u64 = 13;
const ENoPrincipalState: u64 = 14;
const ENavZero: u64 = 15;
const ECopyNotEnabled: u64 = 16;
const EInsufficientCopyPayment: u64 = 17;
const ESealBlobNotSet: u64 = 18;
const EMarginStateExists: u64 = 19;
const ENoMarginState: u64 = 20;
const EMarginBorrowOutstanding: u64 = 21;

// === Events ===

public struct PortfolioCreated has copy, drop, store {
    portfolio_id: ID,
    owner: address,
}

public struct Deposited has copy, drop, store {
    portfolio_id: ID,
    depositor: address,
    amount: u64,
    shares_issued: u64,
}

public struct Withdrawn has copy, drop, store {
    portfolio_id: ID,
    owner: address,
    shares_burned: u64,
    amount: u64,
}

public struct CopyAccessPurchased has copy, drop, store {
    portfolio_id: ID,
    buyer: address,
    fee_paid: u64,
}

public struct NavUpdated has copy, drop, store {
    portfolio_id: ID,
    nav_per_share: u64,
    updated_at: u64,
}

public struct StrategiesConfigured has copy, drop, store {
    portfolio_id: ID,
    enabled_count: u64,
}

public struct ManagerRegistered has copy, drop, store {
    portfolio_id: ID,
    manager_id: ID,
}

// === Structs ===

/// State for the MARGIN_LOOP strategy (⑧ three-protocol composability).
///
/// Tracks collateral locked in MockMargin + the MarginReceipt for borrow/interest accounting.
/// The collateral (DUSDC) is physically in quote_balance; available_balance() deducts it
/// so the keeper cannot accidentally deploy collateral to other strategies.
///
/// Flow each cycle:
///   1. Keeper calls `take_for_margin_borrow` → borrows additional DUSDC → deploys to Predict.
///   2. After settlement, keeper calls `repay_margin_borrow` → repays borrow principal+interest.
///   3. Net P&L = Predict payout − borrow interest (positive when Predict EV > borrow cost).
public struct MarginState has drop, store {
    receipt: MarginReceipt,
    /// Physical collateral amount reserved in quote_balance.
    collateral_amount: u64,
}

/// Proof-of-payment ticket for copying a portfolio's Seal-encrypted configuration.
///
/// Issued by purchase_copy_access after the buyer pays copy_fee to the portfolio owner.
/// Held as an owned object by the buyer; presented (by reference) to seal_approve_copy_purchase
/// so Seal's servers grant the decryption key. Ticket is reusable — buyer paid once, can
/// decrypt the blob multiple times (useful if config changes and new encrypted blob is uploaded).
///
/// Not transferable (no `store`) — only the buyer who paid may use it.
public struct CopyAccessTicket has key {
    id: UID,
    portfolio_id: ID,
    buyer: address,
}

/// Per-strategy configuration. House strategies (0–3) leave all fields None.
/// Bettor strategies (4–6) may override keeper defaults.
public struct StrategyConfig has copy, drop, store {
    /// Min ATM vol to enter. If None, keeper uses hardcoded default from CLAUDE.md Rule 4.
    /// If Some, must be >= hardcoded floor for this strategy kind.
    min_atm_vol_override: Option<u64>,
    /// Strike relative to ATM. 0=ATM, 1=OTM_1tick, 2=OTM_2ticks. Bettor only.
    strike_selection: Option<u8>,
    /// Target notional vol in basis points. Vol-Targeted (⑥) only.
    vol_target_bps: Option<u64>,
    /// Min accumulated yield before placing a Predict bet. Principal-Protected (④) only.
    min_yield_to_bet: Option<u64>,
}

/// One strategy slot inside a portfolio.
public struct StrategySlot has copy, drop, store {
    kind: u8,
    enabled: bool,
    /// Basis points of total portfolio capital allocated to this slot (0–10000).
    /// Sum of all enabled slots must equal exactly 10000.
    allocation_bps: u16,
    config: StrategyConfig,
}

/// State for strategy ④. Lives inside SonarkPortfolio as an Option field.
/// Principal is LOGICALLY locked here — it stays in quote_balance physically
/// but available_balance() subtracts it, so keeper cannot touch it for other strategies.
public struct PrincipalState has copy, drop, store {
    receipt: LendingReceipt,
    yield_accumulated: u64, // yield credited but not yet deployed to Predict
}

/// Composable ownership receipt. Represents `shares` units of a portfolio's NAV.
/// Transferable and NAV-readable: DUSDC_value = shares × portfolio.nav_per_share / SCALING.
public struct PortfolioShare has key, store {
    id: UID,
    portfolio_id: ID,
    shares: u64,
}

/// The core per-user portfolio. One per user (multiple allowed per architecture §12.Q1).
/// Generic over Quote (deposited asset type, e.g. DUSDC on testnet).
///
/// LP tokens from house strategies are stored generically in lp_balances (Bag keyed
/// by TypeName). This avoids a compile-time dependency on the Predict package — the
/// keeper's Phase 4 TypeScript PTBs wire in the concrete PLP type.
public struct SonarkPortfolio<phantom Quote> has key {
    id: UID,
    owner: address,

    // Capital
    quote_balance: Balance<Quote>,
    lp_balances: Bag, // TypeName → Balance<LpToken>

    // Strategy configuration
    strategies: vector<StrategySlot>,

    // Share accounting
    total_shares: u64,
    /// Quote asset units per SCALING shares (keeper-updated off-chain).
    nav_per_share: u64,
    nav_updated_at: u64,

    // Keeper delegation
    manager_id: Option<ID>,
    policy_id: ID,

    // State
    paused: bool,

    // Strategy ④ state (None when not running Principal-Protected)
    principal_state: Option<PrincipalState>,

    // Strategy ⑧ state (None when not running Margin Loop)
    margin_state: Option<MarginState>,

    // Seal copy-trading
    /// Walrus blob ID (UTF-8 bytes) of the Seal-encrypted portfolio config.
    /// Set by owner via set_copy_config. Copiers fetch this blob from Walrus and
    /// decrypt it via seal_approve_copy_purchase after purchasing a CopyAccessTicket.
    seal_blob_id: Option<vector<u8>>,
    /// Fee in Quote units the buyer must pay to receive a CopyAccessTicket.
    /// None = portfolio is not available for copy.
    copy_fee: Option<u64>,
}

// === Public: Portfolio Creation ===

/// Deploy a new portfolio. Caller becomes owner and receives the PolicyCap.
///
/// budget_cap: max quote units keeper can deploy per cycle (e.g. 100_000_000 = 100 DUSDC)
/// expiry_ms: PolicyCap hard expiry (clock timestamp ms); owner must refresh before this
///
/// The returned PolicyCap must be passed to the keeper. The keeper uses it to
/// authorize fund deployment. Owner can destroy it anytime to revoke keeper access.
public fun create<Quote>(
    budget_cap: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): PolicyCap {
    let portfolio_uid = object::new(ctx);
    let portfolio_id = object::uid_to_inner(&portfolio_uid);

    let cap = policy::new(portfolio_id, budget_cap, expiry_ms, ctx);
    let policy_id = object::id(&cap);

    let portfolio = SonarkPortfolio<Quote> {
        id: portfolio_uid,
        owner: ctx.sender(),
        quote_balance: balance::zero(),
        lp_balances: bag::new(ctx),
        strategies: vector::empty(),
        total_shares: 0,
        nav_per_share: SCALING,
        nav_updated_at: clock.timestamp_ms(),
        manager_id: option::none(),
        policy_id,
        paused: false,
        principal_state: option::none(),
        margin_state: option::none(),
        seal_blob_id: option::none(),
        copy_fee: option::none(),
    };

    event::emit(PortfolioCreated { portfolio_id, owner: ctx.sender() });
    transfer::share_object(portfolio);
    cap
}

// === Public: Strategy Configuration ===

/// Set strategy slots. Only the portfolio owner can call this.
/// All enabled slots must sum to exactly 10000 bps.
/// Disabled slots are ignored in the sum. Zero enabled slots allowed (portfolio idle).
public fun configure_strategies<Quote>(
    portfolio: &mut SonarkPortfolio<Quote>,
    slots: vector<StrategySlot>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == portfolio.owner, ENotOwner);
    assert!(slots.length() <= MAX_STRATEGIES, ETooManyStrategies);

    let mut total_bps: u32 = 0;
    let mut i = 0;
    while (i < slots.length()) {
        let slot = &slots[i];
        assert!(slot.kind <= STRATEGY_MARGIN_LOOP, EInvalidStrategyKind);
        if (slot.enabled) {
            total_bps = total_bps + (slot.allocation_bps as u32);
            // User vol override must not go below the hardcoded floor for this strategy.
            if (slot.config.min_atm_vol_override.is_some()) {
                let override_vol = *slot.config.min_atm_vol_override.borrow();
                assert!(override_vol >= default_min_atm_vol(slot.kind), EVolOverrideTooLow);
            };
        };
        i = i + 1;
    };
    // Accept zero enabled slots (portfolio configured but idle)
    assert!(total_bps == 10000 || total_bps == 0, EInvalidAllocations);

    portfolio.strategies = slots;

    let enabled_count = slots.length(); // reported for indexing
    event::emit(StrategiesConfigured {
        portfolio_id: object::id(portfolio),
        enabled_count,
    });
}

// === Public: Deposit ===

/// Deposit quote asset. Returns a PortfolioShare receipt representing ownership.
///
/// Share pricing:
///   - First depositor: 1 share per quote unit (establishes 1:1 baseline)
///   - Subsequent: shares = amount × SCALING / nav_per_share
///
/// Rejects if NAV is stale and there are existing shareholders (prevents frontrunning).
/// Deposits are rejected while paused; withdrawals always work.
public fun deposit<Quote>(
    portfolio: &mut SonarkPortfolio<Quote>,
    coin: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
): PortfolioShare {
    assert!(!portfolio.paused, EPortfolioPaused);
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);

    if (portfolio.total_shares > 0) {
        assert!(
            clock.timestamp_ms() - portfolio.nav_updated_at <= MAX_NAV_AGE_MS,
            ENavStale,
        );
    };

    let shares = if (portfolio.total_shares == 0) {
        amount
    } else {
        mul_div(amount, SCALING, portfolio.nav_per_share)
    };
    assert!(shares > 0, EZeroShares);

    balance::join(&mut portfolio.quote_balance, coin.into_balance());
    portfolio.total_shares = portfolio.total_shares + shares;

    event::emit(Deposited {
        portfolio_id: object::id(portfolio),
        depositor: ctx.sender(),
        amount,
        shares_issued: shares,
    });

    PortfolioShare {
        id: object::new(ctx),
        portfolio_id: object::id(portfolio),
        shares,
    }
}

// === Public: Withdraw ===

/// Burn a PortfolioShare and receive the equivalent quote asset.
///
/// amount = shares × nav_per_share / SCALING
///
/// No NAV staleness check — withdrawals are ALWAYS permitted regardless of keeper state.
/// If quote_balance is insufficient (funds deployed to Predict), keeper must first
/// call take_lp + [Predict withdraw] + store_quote to bring assets back.
public fun withdraw<Quote>(
    portfolio: &mut SonarkPortfolio<Quote>,
    share: PortfolioShare,
    ctx: &mut TxContext,
): Coin<Quote> {
    let PortfolioShare { id, portfolio_id, shares } = share;
    assert!(portfolio_id == object::id(portfolio), EWrongPortfolio);
    id.delete();

    let amount = mul_div(shares, portfolio.nav_per_share, SCALING);
    assert!(amount > 0, EZeroAmount);
    assert!(balance::value(&portfolio.quote_balance) >= amount, EInsufficientBalance);

    portfolio.total_shares = portfolio.total_shares - shares;

    event::emit(Withdrawn {
        portfolio_id: object::id(portfolio),
        owner: ctx.sender(),
        shares_burned: shares,
        amount,
    });

    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

// === Public: Views ===

public fun owner<Q>(p: &SonarkPortfolio<Q>): address { p.owner }
public fun total_shares<Q>(p: &SonarkPortfolio<Q>): u64 { p.total_shares }
public fun nav_per_share<Q>(p: &SonarkPortfolio<Q>): u64 { p.nav_per_share }
public fun nav_updated_at<Q>(p: &SonarkPortfolio<Q>): u64 { p.nav_updated_at }
public fun manager_id<Q>(p: &SonarkPortfolio<Q>): Option<ID> { p.manager_id }
public fun paused<Q>(p: &SonarkPortfolio<Q>): bool { p.paused }
public fun strategies<Q>(p: &SonarkPortfolio<Q>): &vector<StrategySlot> { &p.strategies }

public fun quote_balance<Q>(p: &SonarkPortfolio<Q>): u64 {
    balance::value(&p.quote_balance)
}

public fun lp_balance<Q, Lp>(p: &SonarkPortfolio<Q>): u64 {
    let key = type_name::with_defining_ids<Lp>();
    if (bag::contains(&p.lp_balances, key)) {
        balance::value(bag::borrow<TypeName, Balance<Lp>>(&p.lp_balances, key))
    } else {
        0
    }
}

public fun share_portfolio_id(share: &PortfolioShare): ID { share.portfolio_id }
public fun share_shares(share: &PortfolioShare): u64 { share.shares }

// === Public: Owner Controls ===

/// Pause new deposits. Withdrawals always work regardless.
public fun set_paused<Q>(portfolio: &mut SonarkPortfolio<Q>, paused: bool, ctx: &TxContext) {
    assert!(ctx.sender() == portfolio.owner, ENotOwner);
    portfolio.paused = paused;
}

/// Refresh the PolicyCap budget for a new cycle. Owner signs; keeper benefits.
/// Typically called once per strategy cycle by the owner (or automated via a
/// separate governance object in Phase 5).
public fun refresh_policy<Q>(
    portfolio: &SonarkPortfolio<Q>,
    policy: &mut PolicyCap,
    new_budget_cap: u64,
    new_expiry_ms: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == portfolio.owner, ENotOwner);
    policy::refresh_budget(policy, new_budget_cap, new_expiry_ms);
}

// === Keeper: Setup ===

/// Register the PredictManager ID created by the keeper for this portfolio.
/// Called once by the keeper after portfolio creation.
/// PolicyCap ensures only the authorized keeper can register.
public fun register_manager<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    manager_id: ID,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.manager_id.is_none(), EManagerAlreadySet);
    portfolio.manager_id = option::some(manager_id);
    event::emit(ManagerRegistered {
        portfolio_id: object::id(portfolio),
        manager_id,
    });
}

// === Keeper: NAV Update ===

/// Push updated NAV per share. Required for share issuance math.
/// Keeper computes off-chain: nav = (quote_balance + lp_value + bettor_mtm) / total_shares.
/// lp_value and bettor_mtm are read from Predict shared object via GraphQL/gRPC.
public fun update_nav<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    nav_per_share: u64,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(nav_per_share > 0, ENavZero);
    portfolio.nav_per_share = nav_per_share;
    portfolio.nav_updated_at = clock.timestamp_ms();
    event::emit(NavUpdated {
        portfolio_id: object::id(portfolio),
        nav_per_share,
        updated_at: clock.timestamp_ms(),
    });
}

// === Keeper: Capital Deployment — House Strategies ===

/// Take quote asset from the portfolio to supply to Predict's PLP vault.
/// The caller (keeper PTB) passes this Coin to predict::supply<Quote>.
///
/// Budget consumed. Principal-locked funds are protected — the take is capped
/// by available_balance() which excludes locked principal and accumulated yield.
public fun take_for_supply<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    amount: u64,
    policy: &mut PolicyCap,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Q> {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(amount <= available_balance(portfolio), EInsufficientBalance);
    policy::consume_budget(policy, amount);
    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

/// Store LP tokens received from predict::supply back into the portfolio.
/// Generic over Lp — works with PLP today, any future LP token type.
/// No `store` constraint on Lp: Balance<phantom Lp> always has `store` via phantom.
/// PLP is an OTW type with only `drop`, so `Lp: store` would wrongly reject it.
public fun store_lp<Q, Lp>(
    portfolio: &mut SonarkPortfolio<Q>,
    lp_coin: Coin<Lp>,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    let key = type_name::with_defining_ids<Lp>();
    let incoming = lp_coin.into_balance();
    if (bag::contains(&portfolio.lp_balances, key)) {
        let existing = bag::borrow_mut<TypeName, Balance<Lp>>(&mut portfolio.lp_balances, key);
        balance::join(existing, incoming);
    } else {
        bag::add(&mut portfolio.lp_balances, key, incoming);
    };
}

/// Take LP tokens from the portfolio to redeem via predict::withdraw<Quote>.
/// The caller (keeper PTB) passes this Coin to predict::withdraw.
/// Removes the Bag entry when balance reaches zero, so the Bag stays clean.
/// No `store` constraint on Lp for same reason as store_lp — PLP has only `drop`.
public fun take_lp<Q, Lp>(
    portfolio: &mut SonarkPortfolio<Q>,
    amount: u64,
    policy: &PolicyCap,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Lp> {
    policy::assert_valid(policy, object::id(portfolio), clock);
    let key = type_name::with_defining_ids<Lp>();
    assert!(bag::contains(&portfolio.lp_balances, key), EInsufficientLpBalance);
    // Remove the entire balance, split off the requested amount, put remainder back.
    let mut full = bag::remove<TypeName, Balance<Lp>>(&mut portfolio.lp_balances, key);
    assert!(balance::value(&full) >= amount, EInsufficientLpBalance);
    let out = balance::split(&mut full, amount);
    if (balance::value(&full) > 0) {
        bag::add(&mut portfolio.lp_balances, key, full);
    } else {
        balance::destroy_zero(full);
    };
    coin::from_balance(out, ctx)
}

/// Deposit quote asset back into the portfolio after a Predict withdrawal or redemption.
/// No PolicyCap required — crediting the portfolio is always additive and safe.
public fun store_quote<Q>(portfolio: &mut SonarkPortfolio<Q>, coin: Coin<Q>) {
    balance::join(&mut portfolio.quote_balance, coin.into_balance());
}

// === Keeper: Capital Deployment — Bettor Strategies ===

/// Take quote asset to fund a PredictManager for bettor strategies (⑤⑥⑦).
/// Keeper PTB: take_for_bettor → predict_manager::deposit → predict::mint/mint_range.
/// Budget consumed. Protected balance (principal + yield) excluded.
public fun take_for_bettor<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    amount: u64,
    policy: &mut PolicyCap,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Q> {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(amount <= available_balance(portfolio), EInsufficientBalance);
    policy::consume_budget(policy, amount);
    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

// === Strategy ④: Principal-Protected ===

/// Enable strategy ④ by locking `principal_amount` of the portfolio's quote balance.
///
/// The principal is tracked in PrincipalState.receipt but stays physically in
/// quote_balance. available_balance() subtracts it so the keeper cannot deploy
/// principal to other strategies — the invariant is enforced at the Move level.
///
/// MAINNET: replace the internal accounting mock with an actual IronBank::deposit call
/// that moves the coin to the lending contract.
public fun enable_principal_protected<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    principal_amount: u64,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.principal_state.is_none(), EPrincipalStateExists);
    // Principal must be available (not already deployed elsewhere)
    assert!(principal_amount <= available_balance(portfolio), EInsufficientBalance);

    let receipt = new_receipt(principal_amount, clock);
    portfolio.principal_state = option::some(PrincipalState {
        receipt,
        yield_accumulated: 0,
    });
}

/// Claim yield from MockLending. Updates last_claimed_ms and credits yield_accumulated.
/// Returns the claimed yield amount. The keeper should then provide the equivalent
/// DUSDC via store_quote (platform simulates IronBank payout on testnet).
///
/// MAINNET: IronBank pays yield directly as a coin; call store_quote with the real coin.
public fun claim_yield_from_lending<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    lending: &MockLending,
    policy: &PolicyCap,
    clock: &Clock,
): u64 {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);
    let state = portfolio.principal_state.borrow_mut();
    let yield_amount = accrue_yield(&mut state.receipt, lending, clock);
    state.yield_accumulated = state.yield_accumulated + yield_amount;
    yield_amount
}

/// Take yield for a Predict bet. Reduces yield_accumulated and returns the coin.
/// Keeper PTB: take_yield_for_bet → predict_manager::deposit → predict::mint_range.
///
/// Invariant enforced: ONLY yield_accumulated (never principal) can be used for bets.
public fun take_yield_for_bet<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    amount: u64,
    policy: &mut PolicyCap,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Q> {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);
    let state = portfolio.principal_state.borrow_mut();
    assert!(state.yield_accumulated >= amount, EInsufficientBalance);
    // Only yield_accumulated can fund bets — principal is untouchable.
    state.yield_accumulated = state.yield_accumulated - amount;
    // Take from quote_balance (which has been credited with yield via store_quote)
    assert!(balance::value(&portfolio.quote_balance) >= amount, EInsufficientBalance);
    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

/// Record a Predict bet settlement. Adds payout back to yield_accumulated.
/// Keeper calls this after redeem_permissionless settles the range position.
public fun record_bet_settlement<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    payout_amount: u64,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);
    let state = portfolio.principal_state.borrow_mut();
    state.yield_accumulated = state.yield_accumulated + payout_amount;
}

/// Withdraw principal. Always succeeds regardless of keeper state.
/// No PolicyCap required — this is a user right.
///
/// Enforced invariant: only reduces the locked principal tracking; cannot touch
/// yield_accumulated or any other portfolio assets.
public fun withdraw_principal<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<Q> {
    assert!(ctx.sender() == portfolio.owner, ENotOwner);
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);

    let state = portfolio.principal_state.borrow_mut();
    reduce_principal(&mut state.receipt, amount);

    // Return coins from quote_balance (principal is physically here in the mock).
    // MAINNET: call IronBank::withdraw(amount) which transfers coins from IronBank.
    assert!(balance::value(&portfolio.quote_balance) >= amount, EInsufficientBalance);
    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

/// Testnet-only: fast-forward a portfolio's lending receipt timestamp so that
/// the next claim_yield_from_lending returns `elapsed_ms` worth of yield.
///
/// Useful for keeper testing when real time-based accrual is too slow.
/// Calls mock_lending::admin_fast_forward_yield which enforces lending.admin check.
public fun admin_fast_forward_portfolio_yield<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    lending: &MockLending,
    elapsed_ms: u64,
    ctx: &TxContext,
) {
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);
    let state = portfolio.principal_state.borrow_mut();
    admin_fast_forward_yield(lending, &mut state.receipt, elapsed_ms, ctx);
}

/// Disable strategy ④ once all principal has been withdrawn and yield settled.
/// Clears PrincipalState so it reports None.
public fun disable_principal_protected<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.principal_state.is_some(), ENoPrincipalState);
    let state = portfolio.principal_state.borrow();
    // Only allow disabling when fully wound down
    assert!(principal(state.receipt()) == 0, EInsufficientBalance);
    assert!(state.yield_accumulated == 0, EInsufficientBalance);
    portfolio.principal_state = option::none();
}

// === Public: Seal Copy-Trading ===

/// Owner attaches an encrypted copy of this portfolio's config (uploaded to Walrus).
///
/// seal_blob_id_bytes: UTF-8 bytes of the Walrus blob ID returned by the keeper's
///   encrypt-config CLI after running SealClient.encrypt + Walrus upload.
/// copy_fee_opt: quote units the buyer must pay; pass option::none() to disable copy.
///
/// The encrypted blob contains the full VaultConfig JSON, encrypted under Seal with
/// this portfolio's object ID as the identity. Only a CopyAccessTicket holder can
/// obtain the Seal decryption key (via seal_approve_copy_purchase).
public fun set_copy_config<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    seal_blob_id_bytes: vector<u8>,
    copy_fee_opt: Option<u64>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == portfolio.owner, ENotOwner);
    assert!(!seal_blob_id_bytes.is_empty(), ESealBlobNotSet);
    portfolio.seal_blob_id = option::some(seal_blob_id_bytes);
    portfolio.copy_fee = copy_fee_opt;
}

/// Buyer pays the copy fee and receives a CopyAccessTicket.
///
/// The ticket is owned by ctx.sender() after the PTB transfers it. It serves as
/// proof-of-payment when calling seal_approve_copy_purchase: the Seal key servers
/// verify the approval function does not abort, then release the decryption key.
///
/// payment: any Coin<Q> with value >= copy_fee. Change is returned to sender.
/// The fee (exact amount) is transferred to the portfolio owner.
///
/// The returned ticket has `key` (no `store`): use the PTB's TransferObjects command
/// to assign it to the buyer's address.
#[allow(lint(self_transfer))]
public fun purchase_copy_access<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    mut payment: Coin<Q>,
    ctx: &mut TxContext,
): CopyAccessTicket {
    assert!(portfolio.copy_fee.is_some(), ECopyNotEnabled);
    assert!(portfolio.seal_blob_id.is_some(), ESealBlobNotSet);

    let fee = *portfolio.copy_fee.borrow();
    assert!(payment.value() >= fee, EInsufficientCopyPayment);

    // Split exact fee and pay the owner.
    let fee_coin = payment.split(fee, ctx);
    transfer::public_transfer(fee_coin, portfolio.owner);

    // Return change to buyer.
    if (payment.value() > 0) {
        transfer::public_transfer(payment, ctx.sender());
    } else {
        payment.destroy_zero();
    };

    event::emit(CopyAccessPurchased {
        portfolio_id: object::id(portfolio),
        buyer: ctx.sender(),
        fee_paid: fee,
    });

    CopyAccessTicket {
        id: object::new(ctx),
        portfolio_id: object::id(portfolio),
        buyer: ctx.sender(),
    }
}

/// Seal approval entry function.
///
/// Called via DevInspect by Seal's key servers to decide whether to release the
/// decryption key. If this function does NOT abort, Seal grants the key.
/// If it aborts, Seal refuses.
///
/// _seal_id: the `id` passed to SealClient.encrypt() (this portfolio's object ID as
///   bytes), provided automatically by the Seal SDK when building the approval PTB.
/// portfolio: the shared portfolio whose config was encrypted.
/// ticket: the buyer's CopyAccessTicket proving payment was made.
///
/// Checks:
///   1. seal_blob_id is set (copy is enabled on this portfolio)
///   2. The ticket was issued for THIS portfolio (prevents cross-portfolio replay)
///   3. The ticket holder (buyer) is the caller (ctx.sender())
entry fun seal_approve_copy_purchase<Q>(
    _seal_id: vector<u8>,
    portfolio: &SonarkPortfolio<Q>,
    ticket: &CopyAccessTicket,
    ctx: &TxContext,
) {
    assert!(portfolio.seal_blob_id.is_some(), ESealBlobNotSet);
    assert!(ticket.portfolio_id == object::id(portfolio), EWrongPortfolio);
    assert!(ticket.buyer == ctx.sender(), ENotOwner);
}

// === Public: Seal Views ===

public fun seal_blob_id<Q>(p: &SonarkPortfolio<Q>): Option<vector<u8>> {
    p.seal_blob_id
}

public fun copy_fee<Q>(p: &SonarkPortfolio<Q>): Option<u64> {
    p.copy_fee
}

// === Public: Margin Loop (⑧ Three-Protocol Composability) ===

/// Enable the MARGIN_LOOP strategy by locking `collateral_amount` as margin collateral.
///
/// Collateral stays in quote_balance but is excluded from available_balance() so
/// other strategies cannot inadvertently deploy it. The MarginReceipt tracks
/// borrow capacity (LTV × collateral) and accrued interest.
///
/// Call this once before the first MARGIN_LOOP cycle. Keeper must call
/// take_for_margin_borrow each cycle to borrow and deploy to Predict.
public fun enable_margin_loop<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    margin: &MockMargin,
    collateral_amount: u64,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.margin_state.is_none(), EMarginStateExists);
    assert!(collateral_amount <= available_balance(portfolio), EInsufficientBalance);

    let receipt = mock_margin::open_position(collateral_amount, clock);
    // Verify MockMargin reference is valid (read-only call)
    let _ = mock_margin::ltv_bps(margin);

    portfolio.margin_state = option::some(MarginState {
        receipt,
        collateral_amount,
    });
}

/// Borrow DUSDC against collateral and return a coin for Predict deployment.
///
/// The borrowed amount is constrained by: borrow_capacity = LTV × collateral − outstanding_borrow.
/// Keeper PTB: take_for_margin_borrow → predict_manager::deposit → predict::mint_range.
/// Budget consumed from PolicyCap (borrow counts against the per-cycle budget cap).
public fun take_for_margin_borrow<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    margin: &MockMargin,
    amount: u64,
    policy: &mut PolicyCap,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Q> {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.margin_state.is_some(), ENoMarginState);
    policy::consume_budget(policy, amount);

    let state = portfolio.margin_state.borrow_mut();

    // Record borrow in the receipt (checks LTV constraint)
    mock_margin::record_borrow(&mut state.receipt, margin, amount, clock);

    // The borrowed coin comes from quote_balance (physical model: balance acts as margin pool)
    assert!(balance::value(&portfolio.quote_balance) >= amount + state.collateral_amount, EInsufficientBalance);
    coin::from_balance(balance::split(&mut portfolio.quote_balance, amount), ctx)
}

/// Repay a margin borrow after Predict settlement.
///
/// `repayment`: coin returned from Predict payout.
/// `repay_amount`: amount of repayment to apply to the margin borrow (≤ repayment.value()).
/// Any repayment surplus stays in quote_balance as realized P&L.
///
/// Keeper PTB: (redeem Predict position) → store_quote(payout) → repay_margin_borrow.
public fun repay_margin_borrow<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    margin: &MockMargin,
    repay_amount: u64,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.margin_state.is_some(), ENoMarginState);

    let state = portfolio.margin_state.borrow_mut();
    // Record repayment (applies to interest first, then principal)
    let _ = mock_margin::record_repay(&mut state.receipt, margin, repay_amount, clock);
}

/// Preview current interest owed on margin borrow (non-mutating).
/// Keeper uses this to know the repay amount before building the PTB.
public fun preview_margin_interest<Q>(
    portfolio: &SonarkPortfolio<Q>,
    margin: &MockMargin,
    clock: &Clock,
): u64 {
    if (portfolio.margin_state.is_none()) return 0;
    let state = portfolio.margin_state.borrow();
    mock_margin::preview_interest(&state.receipt, margin, clock)
}

/// Total outstanding margin debt (borrow principal + accrued interest).
public fun margin_total_owed<Q>(p: &SonarkPortfolio<Q>): u64 {
    if (p.margin_state.is_none()) return 0;
    mock_margin::total_owed(&p.margin_state.borrow().receipt)
}

/// Current margin borrow capacity (max additional DUSDC that can be borrowed).
public fun margin_borrow_capacity<Q>(p: &SonarkPortfolio<Q>, margin: &MockMargin): u64 {
    if (p.margin_state.is_none()) return 0;
    borrow_capacity(&p.margin_state.borrow().receipt, margin)
}

/// Disable the MARGIN_LOOP strategy after fully repaying the borrow.
/// Frees the collateral back to available_balance.
/// Reverts if any borrow is still outstanding.
public fun disable_margin_loop<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    policy: &PolicyCap,
    clock: &Clock,
) {
    policy::assert_valid(policy, object::id(portfolio), clock);
    assert!(portfolio.margin_state.is_some(), ENoMarginState);
    let state = portfolio.margin_state.borrow();
    // Enforce full repayment before disabling
    assert!(mock_margin::total_owed(&state.receipt) == 0, EMarginBorrowOutstanding);
    portfolio.margin_state = option::none();
}

/// Fast-forward a portfolio's margin receipt timestamp (testnet only, admin-gated).
/// Used to generate meaningful interest in tests without waiting real time.
public fun admin_fast_forward_margin_interest<Q>(
    portfolio: &mut SonarkPortfolio<Q>,
    margin: &MockMargin,
    elapsed_ms: u64,
    ctx: &TxContext,
) {
    assert!(portfolio.margin_state.is_some(), ENoMarginState);
    let state = portfolio.margin_state.borrow_mut();
    mock_margin::admin_fast_forward_interest(margin, &mut state.receipt, elapsed_ms, ctx);
}

// === Public: MarginState Views ===

public fun has_margin_state<Q>(p: &SonarkPortfolio<Q>): bool {
    p.margin_state.is_some()
}

public fun margin_collateral<Q>(p: &SonarkPortfolio<Q>): u64 {
    if (p.margin_state.is_none()) return 0;
    p.margin_state.borrow().collateral_amount
}

// === Public: StrategySlot / StrategyConfig Constructors ===

/// Create a strategy slot for house strategies (no config needed).
public fun house_slot(kind: u8, allocation_bps: u16): StrategySlot {
    assert!(kind <= STRATEGY_PRINCIPAL_PROTECTED, EInvalidStrategyKind);
    StrategySlot { kind, enabled: true, allocation_bps, config: empty_config() }
}

/// Create a strategy slot for bettor strategies with optional overrides.
public fun bettor_slot(
    kind: u8,
    allocation_bps: u16,
    min_atm_vol_override: Option<u64>,
    strike_selection: Option<u8>,
    vol_target_bps: Option<u64>,
): StrategySlot {
    assert!(kind >= STRATEGY_RANGE_ROLL && kind <= STRATEGY_MARGIN_LOOP, EInvalidStrategyKind);
    StrategySlot {
        kind,
        enabled: true,
        allocation_bps,
        config: StrategyConfig {
            min_atm_vol_override,
            strike_selection,
            vol_target_bps,
            min_yield_to_bet: option::none(),
        },
    }
}

/// Create a strategy slot for strategy ④ Principal-Protected.
public fun pp_slot(allocation_bps: u16, min_yield_to_bet: u64): StrategySlot {
    StrategySlot {
        kind: STRATEGY_PRINCIPAL_PROTECTED,
        enabled: true,
        allocation_bps,
        config: StrategyConfig {
            min_atm_vol_override: option::none(),
            strike_selection: option::none(),
            vol_target_bps: option::none(),
            min_yield_to_bet: option::some(min_yield_to_bet),
        },
    }
}

public fun empty_config(): StrategyConfig {
    StrategyConfig {
        min_atm_vol_override: option::none(),
        strike_selection: option::none(),
        vol_target_bps: option::none(),
        min_yield_to_bet: option::none(),
    }
}

// === Public: PrincipalState Views ===

public fun has_principal_state<Q>(p: &SonarkPortfolio<Q>): bool {
    p.principal_state.is_some()
}

public fun locked_principal<Q>(p: &SonarkPortfolio<Q>): u64 {
    if (p.principal_state.is_none()) return 0;
    principal(p.principal_state.borrow().receipt())
}

public fun yield_accumulated<Q>(p: &SonarkPortfolio<Q>): u64 {
    if (p.principal_state.is_none()) return 0;
    p.principal_state.borrow().yield_accumulated
}

/// Preview accrued yield without mutating any state.
/// Used by keeper DevInspect to know the yield amount before building the PTB.
public fun preview_portfolio_yield<Q>(
    portfolio: &SonarkPortfolio<Q>,
    lending: &MockLending,
    clock: &Clock,
): u64 {
    if (portfolio.principal_state.is_none()) return 0;
    let state = portfolio.principal_state.borrow();
    preview_yield(&state.receipt, lending, clock)
}

// === Private Helpers ===

/// Capital available for keeper deployment.
/// Excludes: locked principal (④), accumulated yield (④), and margin collateral (⑧).
/// This is the on-chain enforcement of capital isolation invariants.
fun available_balance<Q>(p: &SonarkPortfolio<Q>): u64 {
    let total = balance::value(&p.quote_balance);
    let reserved = locked_principal(p) + yield_accumulated(p) + locked_margin_collateral(p);
    if (total > reserved) { total - reserved } else { 0 }
}

fun locked_margin_collateral<Q>(p: &SonarkPortfolio<Q>): u64 {
    if (p.margin_state.is_none()) return 0;
    p.margin_state.borrow().collateral_amount
}

/// round-down multiply-then-divide with u128 intermediate to prevent overflow.
fun mul_div(a: u64, b: u64, c: u64): u64 {
    ((a as u128) * (b as u128) / (c as u128) as u64)
}

/// Hardcoded min ATM vol floors per strategy kind (1e9 scaling).
/// From CLAUDE.md Rule 4. User overrides must not go below these.
fun default_min_atm_vol(kind: u8): u64 {
    if (kind == STRATEGY_PLP_SUPPLIER)        return 150_000_000; // 0.15
    if (kind == STRATEGY_HEDGED_PLP)          return 180_000_000; // 0.18
    if (kind == STRATEGY_SMART_VAULT)         return 180_000_000; // 0.18
    if (kind == STRATEGY_PRINCIPAL_PROTECTED) return 150_000_000; // 0.15
    if (kind == STRATEGY_RANGE_ROLL)          return 280_000_000; // 0.28
    if (kind == STRATEGY_VOL_TARGETED)        return 280_000_000; // 0.28
    if (kind == STRATEGY_VOL_ARB)             return 220_000_000; // 0.22
    if (kind == STRATEGY_MARGIN_LOOP)         return 280_000_000; // 0.28 (bettor-class: borrowed DUSDC in Predict)
    abort EInvalidStrategyKind
}

// PrincipalState accessor (package-level since it's a private struct field)
fun receipt(state: &PrincipalState): &LendingReceipt { &state.receipt }

// === Test-Only ===

#[test_only]
public fun create_for_testing<Q>(
    budget_cap: u64,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (SonarkPortfolio<Q>, PolicyCap) {
    let portfolio_uid = object::new(ctx);
    let portfolio_id = object::uid_to_inner(&portfolio_uid);
    let cap = policy::new(portfolio_id, budget_cap, expiry_ms, ctx);
    let policy_id = object::id(&cap);
    let portfolio = SonarkPortfolio<Q> {
        id: portfolio_uid,
        owner: ctx.sender(),
        quote_balance: balance::zero(),
        lp_balances: bag::new(ctx),
        strategies: vector::empty(),
        total_shares: 0,
        nav_per_share: SCALING,
        nav_updated_at: clock.timestamp_ms(),
        manager_id: option::none(),
        policy_id,
        paused: false,
        principal_state: option::none(),
        margin_state: option::none(),
        seal_blob_id: option::none(),
        copy_fee: option::none(),
    };
    (portfolio, cap)
}

#[test_only]
public fun destroy_for_testing<Q>(portfolio: SonarkPortfolio<Q>) {
    let SonarkPortfolio { id, quote_balance, lp_balances, .. } = portfolio;
    id.delete();
    std::unit_test::destroy(quote_balance);
    std::unit_test::destroy(lp_balances);
}

#[test_only]
public fun destroy_share_for_testing(share: PortfolioShare) {
    let PortfolioShare { id, portfolio_id: _, shares: _ } = share;
    id.delete();
}
