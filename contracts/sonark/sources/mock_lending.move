/// Testnet mock for the iron_bank / money market lending protocol.
///
/// Implements the same interface iron_bank would expose on mainnet:
///   - Track deposited principal via LendingReceipt
///   - Compute yield accrual with real math (not hard-coded)
///   - Preview yield without state change
///
/// MAINNET SWAP: Replace all `mock_lending::*` call sites in portfolio.move
/// with the IronBank SDK calls. The LendingReceipt interface is intentionally
/// identical so the swap is mechanical.
module sonark::mock_lending;

use sui::clock::Clock;

// === Constants ===

/// 365.25 days in milliseconds.
const YEAR_MS: u64 = 31_557_600_000;

// === Errors ===
const ENotAdmin: u64 = 0;
const EInsufficientPrincipal: u64 = 1;

// === Structs ===

/// Shared lending pool. One instance deployed at setup time.
/// Admin sets the simulated APY; all receipts accrue at this rate.
public struct MockLending has key {
    id: UID,
    admin: address,
    simulated_apy_bps: u64, // e.g. 500 = 5.00% APY
}

/// Per-deposit record. Stored inside PrincipalState on the portfolio.
/// Tracks how much principal is locked and when yield was last claimed.
public struct LendingReceipt has copy, drop, store {
    principal: u64,         // quote asset units (6 decimals)
    deposited_at_ms: u64,
    last_claimed_ms: u64,
}

// === Public: Yield Math ===

/// Compute accrued yield since last claim. Updates `last_claimed_ms` in place.
/// Returns yield amount in quote asset units.
///
/// Formula: yield = principal × (apy_bps / 10000) × (elapsed_ms / YEAR_MS)
/// Uses u128 arithmetic to prevent overflow.
public fun accrue_yield(
    receipt: &mut LendingReceipt,
    lending: &MockLending,
    clock: &Clock,
): u64 {
    let now_ms = clock.timestamp_ms();
    let elapsed_ms = now_ms - receipt.last_claimed_ms;
    if (elapsed_ms == 0) return 0;

    let yield_amount = (receipt.principal as u128)
        * (lending.simulated_apy_bps as u128)
        * (elapsed_ms as u128)
        / (10_000u128 * (YEAR_MS as u128));

    receipt.last_claimed_ms = now_ms;
    (yield_amount as u64)
}

/// Preview yield without mutating state. For keeper off-chain estimation.
public fun preview_yield(
    receipt: &LendingReceipt,
    lending: &MockLending,
    clock: &Clock,
): u64 {
    let now_ms = clock.timestamp_ms();
    let elapsed_ms = now_ms - receipt.last_claimed_ms;
    if (elapsed_ms == 0) return 0;

    let yield_amount = (receipt.principal as u128)
        * (lending.simulated_apy_bps as u128)
        * (elapsed_ms as u128)
        / (10_000u128 * (YEAR_MS as u128));
    (yield_amount as u64)
}

/// Reduce locked principal. Called on partial or full principal withdrawal.
public fun reduce_principal(receipt: &mut LendingReceipt, amount: u64) {
    assert!(receipt.principal >= amount, EInsufficientPrincipal);
    receipt.principal = receipt.principal - amount;
}

// === Public: Views ===

public fun principal(receipt: &LendingReceipt): u64 { receipt.principal }
public fun last_claimed_ms(receipt: &LendingReceipt): u64 { receipt.last_claimed_ms }
public fun simulated_apy_bps(lending: &MockLending): u64 { lending.simulated_apy_bps }

// === Package: Called by portfolio.move ===

/// Create a LendingReceipt for a new principal deposit.
public(package) fun new_receipt(principal: u64, clock: &Clock): LendingReceipt {
    let now_ms = clock.timestamp_ms();
    LendingReceipt {
        principal,
        deposited_at_ms: now_ms,
        last_claimed_ms: now_ms,
    }
}

// === Public: Admin / Deployment ===

/// Deploy the shared MockLending object. Called once by the platform deployer.
public fun create(simulated_apy_bps: u64, ctx: &mut TxContext) {
    transfer::share_object(MockLending {
        id: object::new(ctx),
        admin: ctx.sender(),
        simulated_apy_bps,
    });
}

/// Update the simulated APY rate (admin only).
public fun set_apy(lending: &mut MockLending, new_apy_bps: u64, ctx: &TxContext) {
    assert!(ctx.sender() == lending.admin, ENotAdmin);
    lending.simulated_apy_bps = new_apy_bps;
}

/// Fast-forward a receipt's last_claimed_ms backward by `elapsed_ms` so the
/// next accrue_yield call returns a predictable amount (testnet only).
///
/// Use case: on testnet, time-based yield accrual at 5% APY on 100 DUSDC
/// only produces ~0.0000095 DUSDC per second — too small for realistic
/// keeper testing. Call this once after enable_principal_protected to make
/// the receipt appear as if `elapsed_ms` has already passed, then run the
/// keeper cycle to observe a meaningful yield claim + bet.
///
/// Safe: does NOT change principal or total APY parameters. Does NOT mint
/// any coin — only adjusts the timestamp so `accrue_yield` returns more.
/// Admin-only to prevent abuse.
public fun admin_fast_forward_yield(
    lending: &MockLending,
    receipt: &mut LendingReceipt,
    elapsed_ms: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == lending.admin, ENotAdmin);
    // Move last_claimed_ms backward by elapsed_ms so next accrue_yield sees
    // that duration as "unclaimed". Clamp to deposited_at_ms floor.
    if (receipt.last_claimed_ms > elapsed_ms) {
        receipt.last_claimed_ms = receipt.last_claimed_ms - elapsed_ms;
    } else {
        receipt.last_claimed_ms = receipt.deposited_at_ms;
    }
}
