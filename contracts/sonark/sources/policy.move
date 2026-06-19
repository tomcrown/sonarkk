/// Revocable keeper capability for a SonarkPortfolio.
/// The user holds this object. Destroying it immediately revokes keeper authority.
/// Budget cap limits blast radius if the keeper key is compromised.
module sonark::policy;

use sui::clock::Clock;

// === Errors ===
const EBudgetExhausted: u64 = 0;
const ECapExpired: u64 = 1;
const EWrongPortfolio: u64 = 2;

// === Structs ===

/// Keeper capability. Owned by the user; required by all keeper-side portfolio functions.
///
/// - `budget_remaining`: DUSDC (6 decimals) keeper can deploy this cycle before refresh.
/// - `expiry_ms`: Clock timestamp after which the cap is invalid; user must renew.
public struct PolicyCap has key, store {
    id: UID,
    portfolio_id: ID,
    budget_remaining: u64,
    budget_cap: u64,
    expiry_ms: u64,
}

// === Public: User-Facing ===

/// Destroy the PolicyCap, revoking keeper authority over the associated portfolio.
/// After this, the keeper cannot call any fund-deployment function.
/// Withdrawals and principal returns still work — they don't require PolicyCap.
public fun revoke(cap: PolicyCap) {
    let PolicyCap { id, .. } = cap;
    id.delete();
}

public fun portfolio_id(cap: &PolicyCap): ID { cap.portfolio_id }
public fun budget_remaining(cap: &PolicyCap): u64 { cap.budget_remaining }
public fun budget_cap(cap: &PolicyCap): u64 { cap.budget_cap }
public fun expiry_ms(cap: &PolicyCap): u64 { cap.expiry_ms }

// === Package: Called by portfolio.move ===

/// Create a new PolicyCap. Only callable from within the sonark package.
public(package) fun new(
    portfolio_id: ID,
    budget_cap: u64,
    expiry_ms: u64,
    ctx: &mut TxContext,
): PolicyCap {
    PolicyCap {
        id: object::new(ctx),
        portfolio_id,
        budget_remaining: budget_cap,
        budget_cap,
        expiry_ms,
    }
}

/// Assert cap is valid: targets the right portfolio, is not expired, has budget left.
/// Use for capital-deployment actions (take_for_supply, take_for_bettor, take_for_bet).
public(package) fun assert_valid(cap: &PolicyCap, portfolio_id: ID, clock: &Clock) {
    assert!(cap.portfolio_id == portfolio_id, EWrongPortfolio);
    assert!(clock.timestamp_ms() < cap.expiry_ms, ECapExpired);
    assert!(cap.budget_remaining > 0, EBudgetExhausted);
}

/// Assert cap is authorized: targets the right portfolio and is not expired.
/// Does NOT check budget_remaining — use for credit/return operations (store_lp,
/// take_lp) where the keeper is acting on already-deployed capital, not deploying new funds.
public(package) fun assert_authorized(cap: &PolicyCap, portfolio_id: ID, clock: &Clock) {
    assert!(cap.portfolio_id == portfolio_id, EWrongPortfolio);
    assert!(clock.timestamp_ms() < cap.expiry_ms, ECapExpired);
}

/// Consume budget. Called on every keeper fund-deployment action.
public(package) fun consume_budget(cap: &mut PolicyCap, amount: u64) {
    assert!(cap.budget_remaining >= amount, EBudgetExhausted);
    cap.budget_remaining = cap.budget_remaining - amount;
}

/// Reset the budget for a new cycle. Called by portfolio::refresh_policy (owner signs).
public(package) fun refresh_budget(cap: &mut PolicyCap, new_budget_cap: u64, new_expiry_ms: u64) {
    cap.budget_remaining = new_budget_cap;
    cap.budget_cap = new_budget_cap;
    cap.expiry_ms = new_expiry_ms;
}
