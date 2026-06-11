#[test_only]
module sonark::portfolio_tests;

use sonark::portfolio::{Self, SonarkPortfolio};
use sonark::policy::PolicyCap;
use sui::{clock, coin};

// === Test phantom coin types ===
public struct TESTQ has drop {}          // test quote asset (stands in for DUSDC)
public struct TESTLP has drop, store {}  // test LP token (stands in for PLP); store required by Bag

// === Helpers ===

fun make_portfolio(ctx: &mut TxContext, clock: &clock::Clock): (SonarkPortfolio<TESTQ>, PolicyCap) {
    portfolio::create_for_testing<TESTQ>(
        10_000_000, // budget_cap: 10 TESTQ
        999_999_999_999,
        clock,
        ctx,
    )
}

// ── Portfolio creation ────────────────────────────────────────────────────────

#[test]
fun test_create_portfolio() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);

    let (portfolio, cap) = make_portfolio(&mut ctx, &clock);

    assert!(portfolio.total_shares() == 0);
    assert!(portfolio.quote_balance() == 0);
    assert!(portfolio.paused() == false);
    assert!(portfolio.manager_id().is_none());
    assert!(!portfolio.has_principal_state());

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── Deposit and withdraw ──────────────────────────────────────────────────────

#[test]
fun test_first_deposit_one_to_one() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    let coin = coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx); // 1 TESTQ (6 decimals)
    let share = portfolio.deposit(coin, &clock, &mut ctx);

    // First depositor: 1 share per quote unit
    assert!(share.share_shares() == 1_000_000);
    assert!(portfolio.total_shares() == 1_000_000);
    assert!(portfolio.quote_balance() == 1_000_000);

    // Withdraw with the share
    let returned = portfolio.withdraw(share, &mut ctx);
    assert!(returned.value() == 1_000_000);
    assert!(portfolio.total_shares() == 0);

    clock.destroy_for_testing();
    coin::burn_for_testing(returned);
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test]
fun test_second_deposit_proportional() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // First deposit: 1_000_000 → 1_000_000 shares at 1:1
    let share1 = portfolio.deposit(
        coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx), &clock, &mut ctx,
    );

    // Simulate NAV update: nav_per_share = 1e9 (unchanged — no PnL yet)
    portfolio.update_nav(1_000_000_000, &cap, &clock);

    // Second deposit: 2_000_000 → shares = 2_000_000 × 1e9 / 1e9 = 2_000_000
    let share2 = portfolio.deposit(
        coin::mint_for_testing<TESTQ>(2_000_000, &mut ctx), &clock, &mut ctx,
    );
    assert!(share2.share_shares() == 2_000_000);
    assert!(portfolio.total_shares() == 3_000_000);

    // Clean up
    let c1 = portfolio.withdraw(share1, &mut ctx);
    let c2 = portfolio.withdraw(share2, &mut ctx);
    coin::burn_for_testing(c1);
    coin::burn_for_testing(c2);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::EZeroAmount)]
fun test_deposit_zero_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    let zero = coin::mint_for_testing<TESTQ>(0, &mut ctx);
    let share = portfolio.deposit(zero, &clock, &mut ctx); // aborts here

    // unreachable — satisfies type checker for non-drop PortfolioShare
    portfolio::destroy_share_for_testing(share);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::ENavStale)]
fun test_deposit_rejects_stale_nav() {
    let mut ctx = tx_context::dummy();
    let mut clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // First deposit to have existing shares
    let share1 = portfolio.deposit(
        coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx), &clock, &mut ctx,
    );

    // Advance clock past MAX_NAV_AGE_MS (600_000 ms = 10 minutes)
    clock.set_for_testing(700_000);

    // Second deposit should be rejected — NAV is stale
    let share2 = portfolio.deposit(
        coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx), &clock, &mut ctx,
    ); // aborts here

    // unreachable — satisfies type checker
    transfer::public_transfer(share2, @0x0);
    let c = portfolio.withdraw(share1, &mut ctx);
    coin::burn_for_testing(c);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── Strategy configuration ────────────────────────────────────────────────────

#[test]
fun test_configure_single_strategy() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    let slots = vector[portfolio::house_slot(0, 10000)]; // 100% PLP Supplier
    portfolio.configure_strategies(slots, &ctx);

    assert!(portfolio.strategies().length() == 1);

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test]
fun test_configure_two_strategies() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // 60% PLP Supplier + 40% Range-Roll
    let slots = vector[
        portfolio::house_slot(0, 6000),
        portfolio::bettor_slot(4, 4000, option::none(), option::none(), option::none()),
    ];
    portfolio.configure_strategies(slots, &ctx);

    assert!(portfolio.strategies().length() == 2);

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::EInvalidAllocations)]
fun test_configure_wrong_total_bps_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // 60% + 30% = 90% — invalid
    let slots = vector[
        portfolio::house_slot(0, 6000),
        portfolio::house_slot(1, 3000),
    ];
    portfolio.configure_strategies(slots, &ctx); // aborts here

    // unreachable
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::EVolOverrideTooLow)]
fun test_vol_override_below_floor_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // Range-Roll floor = 280_000_000. Override at 200_000_000 should fail.
    let slots = vector[
        portfolio::bettor_slot(
            4, 10000,
            option::some(200_000_000), // below 0.28 floor
            option::none(),
            option::none(),
        ),
    ];
    portfolio.configure_strategies(slots, &ctx); // aborts here

    // unreachable
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── Policy enforcement ────────────────────────────────────────────────────────

#[test]
fun test_take_for_supply_consumes_budget() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, mut cap) = make_portfolio(&mut ctx, &clock);

    // Deposit 5 TESTQ
    let deposit_coin = coin::mint_for_testing<TESTQ>(5_000_000, &mut ctx);
    let share = portfolio.deposit(deposit_coin, &clock, &mut ctx);

    // Take 3 TESTQ for supply
    let taken = portfolio.take_for_supply(3_000_000, &mut cap, &clock, &mut ctx);
    assert!(taken.value() == 3_000_000);
    assert!(portfolio.quote_balance() == 2_000_000);
    assert!(cap.budget_remaining() == 10_000_000 - 3_000_000);

    // Capital was burned externally to simulate a Predict deployment.
    // Destroy the share receipt without trying to redeem it against the now-depleted portfolio.
    coin::burn_for_testing(taken);
    portfolio::destroy_share_for_testing(share);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test]
fun test_store_lp_and_take_lp() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // Store some fake LP tokens
    let lp_coin = coin::mint_for_testing<TESTLP>(500_000, &mut ctx);
    portfolio.store_lp<TESTQ, TESTLP>(lp_coin, &cap, &clock);
    assert!(portfolio.lp_balance<TESTQ, TESTLP>() == 500_000);

    // Take some back
    let taken_lp = portfolio.take_lp<TESTQ, TESTLP>(200_000, &cap, &clock, &mut ctx);
    assert!(taken_lp.value() == 200_000);
    assert!(portfolio.lp_balance<TESTQ, TESTLP>() == 300_000);

    coin::burn_for_testing(taken_lp);
    // Clean up remaining LP
    let remaining = portfolio.take_lp<TESTQ, TESTLP>(300_000, &cap, &clock, &mut ctx);
    coin::burn_for_testing(remaining);

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::EInsufficientBalance)]
fun test_take_more_than_available_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, mut cap) = make_portfolio(&mut ctx, &clock);

    let deposit_coin = coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx);
    let share = portfolio.deposit(deposit_coin, &clock, &mut ctx);

    // Try to take more than deposited
    let taken = portfolio.take_for_supply(2_000_000, &mut cap, &clock, &mut ctx); // aborts here

    // unreachable — satisfies type checker
    coin::burn_for_testing(taken);
    let c = portfolio.withdraw(share, &mut ctx);
    coin::burn_for_testing(c);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── NAV update ────────────────────────────────────────────────────────────────

#[test]
fun test_nav_update() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    assert!(portfolio.nav_per_share() == 1_000_000_000); // initial 1:1

    portfolio.update_nav(1_200_000_000, &cap, &clock); // 20% gain
    assert!(portfolio.nav_per_share() == 1_200_000_000);

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── Pause guard ───────────────────────────────────────────────────────────────

#[test, expected_failure(abort_code = sonark::portfolio::EPortfolioPaused)]
fun test_deposit_while_paused_fails() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    portfolio.set_paused(true, &ctx);

    let coin = coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx);
    let share = portfolio.deposit(coin, &clock, &mut ctx); // aborts here

    // unreachable — satisfies type checker
    transfer::public_transfer(share, @0x0);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── Principal-Protected isolation ─────────────────────────────────────────────

#[test]
fun test_principal_isolation() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, mut cap) = make_portfolio(&mut ctx, &clock);

    // Deposit 10 TESTQ
    let deposit = coin::mint_for_testing<TESTQ>(10_000_000, &mut ctx);
    let share = portfolio.deposit(deposit, &clock, &mut ctx);

    // Lock 8 TESTQ as principal for strategy ④
    portfolio.enable_principal_protected(8_000_000, &cap, &clock);
    assert!(portfolio.locked_principal() == 8_000_000);

    // Only 2 TESTQ should be available for other strategies
    assert!(portfolio.quote_balance() == 10_000_000); // coins still here physically

    // Keeper can take at most 2 TESTQ
    let taken = portfolio.take_for_supply(2_000_000, &mut cap, &clock, &mut ctx);
    assert!(taken.value() == 2_000_000);
    coin::burn_for_testing(taken);

    // User can withdraw principal directly (no keeper needed)
    let principal_out = portfolio.withdraw_principal(8_000_000, &mut ctx);
    assert!(principal_out.value() == 8_000_000);
    assert!(portfolio.locked_principal() == 0);
    coin::burn_for_testing(principal_out);

    // Portfolio is now empty (2 burned externally by keeper, 8 returned as principal).
    // Destroy the share receipt without redeeming — its value has been disbursed.
    portfolio::destroy_share_for_testing(share);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

#[test, expected_failure(abort_code = sonark::portfolio::EInsufficientBalance)]
fun test_keeper_cannot_touch_principal() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, mut cap) = make_portfolio(&mut ctx, &clock);

    // Deposit 5 TESTQ, lock all 5 as principal
    let deposit = coin::mint_for_testing<TESTQ>(5_000_000, &mut ctx);
    let share = portfolio.deposit(deposit, &clock, &mut ctx);
    portfolio.enable_principal_protected(5_000_000, &cap, &clock);

    // Keeper tries to take any amount — available_balance is 0, should fail
    let taken = portfolio.take_for_supply(1, &mut cap, &clock, &mut ctx); // aborts here

    // unreachable — satisfies type checker
    coin::burn_for_testing(taken);
    let c = portfolio.withdraw(share, &mut ctx);
    coin::burn_for_testing(c);
    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}

// ── store_quote ───────────────────────────────────────────────────────────────

#[test]
fun test_store_quote_no_policy_needed() {
    let mut ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    let (mut portfolio, cap) = make_portfolio(&mut ctx, &clock);

    // Anyone can credit the portfolio with quote asset (additive, safe)
    let external_coin = coin::mint_for_testing<TESTQ>(1_000_000, &mut ctx);
    portfolio.store_quote(external_coin);
    assert!(portfolio.quote_balance() == 1_000_000);

    clock.destroy_for_testing();
    portfolio::destroy_for_testing(portfolio);
    cap.revoke();
}
