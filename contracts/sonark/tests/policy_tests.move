#[test_only]
module sonark::policy_tests;

use sonark::policy;
use sui::clock;

// ── helpers ──────────────────────────────────────────────────────────────────

fun dummy_id(ctx: &mut TxContext): ID {
    let uid = object::new(ctx);
    let id = object::uid_to_inner(&uid);
    uid.delete();
    id
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[test]
fun test_create_and_read() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let expiry = 86_400_000u64; // 1 day in ms

    let cap = policy::new(portfolio_id, 1_000_000_000, expiry, &mut ctx);

    assert!(cap.portfolio_id() == portfolio_id);
    assert!(cap.budget_remaining() == 1_000_000_000);
    assert!(cap.budget_cap() == 1_000_000_000);
    assert!(cap.expiry_ms() == expiry);

    cap.revoke();
}

#[test]
fun test_consume_budget() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let mut cap = policy::new(portfolio_id, 1_000_000_000, 999_999_999_999, &mut ctx);

    policy::consume_budget(&mut cap, 300_000_000);
    assert!(cap.budget_remaining() == 700_000_000);

    policy::consume_budget(&mut cap, 700_000_000);
    assert!(cap.budget_remaining() == 0);

    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::policy::EBudgetExhausted)]
fun test_consume_over_budget_fails() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let mut cap = policy::new(portfolio_id, 100, 999_999_999_999, &mut ctx);

    policy::consume_budget(&mut cap, 101); // should abort

    // unreachable — satisfies type checker
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::policy::ECapExpired)]
fun test_assert_valid_expired_fails() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let cap = policy::new(portfolio_id, 1_000, 1_000, &mut ctx); // expires at ms=1000

    let mut clock = clock::create_for_testing(&mut ctx);
    clock.set_for_testing(2_000); // clock is past expiry

    policy::assert_valid(&cap, portfolio_id, &clock);

    // unreachable — satisfies type checker
    clock.destroy_for_testing();
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::policy::EWrongPortfolio)]
fun test_assert_valid_wrong_portfolio_fails() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let wrong_id = dummy_id(&mut ctx);
    let cap = policy::new(portfolio_id, 1_000, 999_999_999_999, &mut ctx);

    let clock = clock::create_for_testing(&mut ctx);
    policy::assert_valid(&cap, wrong_id, &clock); // should abort

    // unreachable — satisfies type checker
    clock.destroy_for_testing();
    cap.revoke();
}

#[test]
fun test_refresh_budget() {
    let mut ctx = tx_context::dummy();
    let portfolio_id = dummy_id(&mut ctx);
    let mut cap = policy::new(portfolio_id, 500, 1_000, &mut ctx);

    policy::consume_budget(&mut cap, 500);
    assert!(cap.budget_remaining() == 0);

    policy::refresh_budget(&mut cap, 1_000, 999_999_999_999);
    assert!(cap.budget_remaining() == 1_000);
    assert!(cap.budget_cap() == 1_000);
    assert!(cap.expiry_ms() == 999_999_999_999);

    cap.revoke();
}
