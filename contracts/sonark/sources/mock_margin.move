/// Testnet mock for the deepbook_margin / cross-margin lending protocol.
///
/// Models a collateralized borrowing facility:
///   - Depositor locks Quote as collateral.
///   - Can borrow up to LTV% of collateral value in the same Quote.
///   - Interest accrues on the borrow at `borrow_rate_bps` APY.
///   - Collateral can only be withdrawn when borrow is fully repaid.
///
/// Three-protocol composability (MARGIN_LOOP strategy):
///   [DUSDC collateral] → MockMargin.borrow → [Borrowed DUSDC] → Predict.mint_range
///   Settlement: Predict payout → MockMargin.repay_borrow → [Collateral freed]
///   Net P&L: Predict payout − borrow interest. Positive when Predict EV > borrow cost.
///
/// MAINNET SWAP: Replace mock_margin::* call sites with DeepBook Margin SDK calls.
/// The MarginReceipt interface is intentionally identical to ease the swap.
module sonark::mock_margin;

use sui::clock::Clock;

// === Constants ===

/// 365.25 days in milliseconds.
const YEAR_MS: u64 = 31_557_600_000;

/// Maximum LTV cap enforced regardless of admin setting (safety guard).
const MAX_LTV_BPS: u64 = 9000; // 90% max LTV

// === Errors ===

const ENotAdmin:          u64 = 0;
const EBorrowExceedsLtv:  u64 = 1;
const ERepayExceedsBorrow: u64 = 2;
const ECollateralLocked:  u64 = 3; // borrow outstanding — cannot withdraw
const ELtvTooHigh:        u64 = 4;
const EZeroCollateral:    u64 = 5;

// === Structs ===

/// Shared margin pool. One instance deployed by setup.
/// Admin controls LTV and borrow rate parameters.
public struct MockMargin has key {
    id: UID,
    admin: address,
    /// Max loan-to-value in basis points. 7500 = 75% LTV.
    ltv_bps: u64,
    /// Annual borrow interest rate in basis points. 800 = 8% APR.
    borrow_rate_bps: u64,
}

/// Per-position receipt. Stored in portfolio's MarginState.
/// Tracks: collateral deposited, amount currently borrowed, accrued interest.
public struct MarginReceipt has copy, drop, store {
    collateral:       u64,  // quote asset units locked as collateral
    amount_borrowed:  u64,  // current outstanding borrow principal
    interest_accrued: u64,  // interest accrued but not yet repaid
    opened_at_ms:     u64,  // when position was opened
    last_accrued_ms:  u64,  // timestamp of last interest accrual
}

// === Public: Interest Math ===

/// Accrue interest on the borrow since last accrual. Mutates the receipt.
/// Returns the new interest amount accrued in this call (in quote units).
///
/// Formula: interest_new = borrow_principal × (rate_bps / 10000) × (elapsed_ms / YEAR_MS)
/// Uses u128 to prevent overflow.
public fun accrue_interest(
    receipt: &mut MarginReceipt,
    margin: &MockMargin,
    clock: &Clock,
): u64 {
    if (receipt.amount_borrowed == 0) return 0;

    let now_ms = clock.timestamp_ms();
    let elapsed_ms = now_ms - receipt.last_accrued_ms;
    if (elapsed_ms == 0) return 0;

    let interest = (receipt.amount_borrowed as u128)
        * (margin.borrow_rate_bps as u128)
        * (elapsed_ms as u128)
        / (10_000u128 * (YEAR_MS as u128));

    receipt.interest_accrued = receipt.interest_accrued + (interest as u64);
    receipt.last_accrued_ms = now_ms;
    (interest as u64)
}

/// Preview interest without mutating state. For keeper off-chain estimation.
public fun preview_interest(
    receipt: &MarginReceipt,
    margin: &MockMargin,
    clock: &Clock,
): u64 {
    if (receipt.amount_borrowed == 0) return 0;
    let now_ms = clock.timestamp_ms();
    let elapsed_ms = now_ms - receipt.last_accrued_ms;
    if (elapsed_ms == 0) return 0;

    let interest = (receipt.amount_borrowed as u128)
        * (margin.borrow_rate_bps as u128)
        * (elapsed_ms as u128)
        / (10_000u128 * (YEAR_MS as u128));
    (interest as u64)
}

/// Maximum additional amount that can be borrowed given current collateral and borrow.
public fun borrow_capacity(receipt: &MarginReceipt, margin: &MockMargin): u64 {
    let max_borrow = receipt.collateral * margin.ltv_bps / 10_000;
    let total_owed = receipt.amount_borrowed + receipt.interest_accrued;
    if (max_borrow > total_owed) { max_borrow - total_owed } else { 0 }
}

// === Public: Views ===

public fun collateral(r: &MarginReceipt): u64 { r.collateral }
public fun amount_borrowed(r: &MarginReceipt): u64 { r.amount_borrowed }
public fun interest_accrued(r: &MarginReceipt): u64 { r.interest_accrued }
public fun total_owed(r: &MarginReceipt): u64 { r.amount_borrowed + r.interest_accrued }
public fun ltv_bps(m: &MockMargin): u64 { m.ltv_bps }
public fun borrow_rate_bps(m: &MockMargin): u64 { m.borrow_rate_bps }

// === Package-Level: Called by portfolio.move ===

/// Open a new margin position. Returns a receipt tracking the collateral.
/// The collateral coin is consumed (caller passes ownership).
/// Note: in the real protocol, collateral would move to the margin contract's vault.
/// In this mock, collateral stays in the portfolio's quote_balance; we track it
/// logically in the receipt (identical to how mock_lending tracks principal).
public(package) fun open_position(
    collateral_amount: u64,
    clock: &Clock,
): MarginReceipt {
    let now_ms = clock.timestamp_ms();
    MarginReceipt {
        collateral:       collateral_amount,
        amount_borrowed:  0,
        interest_accrued: 0,
        opened_at_ms:     now_ms,
        last_accrued_ms:  now_ms,
    }
}

/// Increase collateral in an existing position.
public(package) fun add_collateral(
    receipt: &mut MarginReceipt,
    additional: u64,
) {
    receipt.collateral = receipt.collateral + additional;
}

/// Borrow against collateral. Returns the borrowed amount.
/// Reverts if borrow exceeds LTV × collateral.
/// Caller must provide the coin from the portfolio's balance (external).
/// The receipt records the new borrow; the actual coin movement is in portfolio.move.
public(package) fun record_borrow(
    receipt: &mut MarginReceipt,
    margin: &MockMargin,
    amount: u64,
    clock: &Clock,
) {
    // Accrue any outstanding interest first (affects capacity check)
    let _interest = accrue_interest(receipt, margin, clock);

    let capacity = borrow_capacity(receipt, margin);
    assert!(amount <= capacity, EBorrowExceedsLtv);

    receipt.amount_borrowed = receipt.amount_borrowed + amount;
}

/// Repay borrow principal + interest. Reduces amount_borrowed first (favors borrower).
/// Returns the excess (if any) that should be credited back to caller.
/// Reverts if repayment > amount owed.
public(package) fun record_repay(
    receipt: &mut MarginReceipt,
    margin: &MockMargin,
    repay_amount: u64,
    clock: &Clock,
): u64 {
    // Accrue final interest before repayment
    let _interest = accrue_interest(receipt, margin, clock);

    let owed = receipt.amount_borrowed + receipt.interest_accrued;
    assert!(repay_amount <= owed, ERepayExceedsBorrow);

    // Apply repayment to interest first, then principal
    if (repay_amount <= receipt.interest_accrued) {
        receipt.interest_accrued = receipt.interest_accrued - repay_amount;
        0  // no excess
    } else {
        let after_interest = repay_amount - receipt.interest_accrued;
        receipt.interest_accrued = 0;
        receipt.amount_borrowed = receipt.amount_borrowed - after_interest;
        0  // no excess
    }
}

/// Reduce collateral after full borrow repayment.
/// Reverts if borrow is still outstanding.
public(package) fun reduce_collateral(
    receipt: &mut MarginReceipt,
    amount: u64,
) {
    assert!(receipt.amount_borrowed == 0 && receipt.interest_accrued == 0, ECollateralLocked);
    assert!(receipt.collateral >= amount, EZeroCollateral);
    receipt.collateral = receipt.collateral - amount;
}

// === Public: Admin / Deployment ===

/// Deploy the shared MockMargin object. Called once at setup.
/// ltv_bps: loan-to-value (e.g. 7500 = 75% LTV)
/// borrow_rate_bps: annual borrow rate (e.g. 800 = 8% APR)
public fun create(
    ltv_bps: u64,
    borrow_rate_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(ltv_bps <= MAX_LTV_BPS, ELtvTooHigh);
    transfer::share_object(MockMargin {
        id: object::new(ctx),
        admin: ctx.sender(),
        ltv_bps,
        borrow_rate_bps,
    });
}

/// Update LTV and borrow rate (admin only).
public fun set_rates(
    margin: &mut MockMargin,
    ltv_bps: u64,
    borrow_rate_bps: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == margin.admin, ENotAdmin);
    assert!(ltv_bps <= MAX_LTV_BPS, ELtvTooHigh);
    margin.ltv_bps = ltv_bps;
    margin.borrow_rate_bps = borrow_rate_bps;
}

/// Testnet fast-forward: make the position appear older to generate more interest.
/// Admin-only. Same pattern as mock_lending::admin_fast_forward_yield.
public fun admin_fast_forward_interest(
    margin: &MockMargin,
    receipt: &mut MarginReceipt,
    elapsed_ms: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == margin.admin, ENotAdmin);
    if (receipt.last_accrued_ms > elapsed_ms) {
        receipt.last_accrued_ms = receipt.last_accrued_ms - elapsed_ms;
    } else {
        receipt.last_accrued_ms = receipt.opened_at_ms;
    }
}

// === Test-Only ===

#[test_only]
public fun new_receipt_for_testing(collateral: u64, clock: &Clock): MarginReceipt {
    open_position(collateral, clock)
}
