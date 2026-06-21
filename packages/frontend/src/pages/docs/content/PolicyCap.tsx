import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function PolicyCap() {
  return (
    <DocPage
      section={getSectionForSlug('policy-cap')}
      title="PolicyCap & Authorization"
      tagline="The on-chain permission object that defines and bounds what the keeper can do."
    >
      <H2>Overview</H2>
      <P>
        The <Strong>PolicyCap</Strong> is a Move capability object created on-chain when a user
        deploys a strategy. It encodes the exact boundaries of the keeper's authority: which portfolio
        it can act on, how much DUSDC it can move in total, which protocol actions are in scope, and
        when the permission expires. The keeper holds the PolicyCap and cannot act beyond what it
        permits.
      </P>
      <P>
        This model means the user never gives the keeper their private key. Instead, the user's wallet
        signs one transaction to create and transfer the PolicyCap. From that point the keeper can
        call designated functions — but only within the cap's constraints.
      </P>

      <H2>What the cap enforces</H2>
      <H3>Budget ceiling</H3>
      <P>
        The cap records a <Strong>lifetime DUSDC budget</Strong> — the maximum total amount the keeper
        can move out of the vault across all cycles. Each deployment decrements this counter. When the
        budget is exhausted, the keeper automatically stops opening new positions until the user signs
        a refresh transaction to top it up. This means even if the keeper key were compromised, the
        attacker can only move up to the remaining budget — not the user's entire balance.
      </P>
      <H3>Scope</H3>
      <P>
        The cap is scoped to <Strong>Predict-only operations</Strong> on the specific portfolio it was
        created for. The keeper can call <Strong>take_for_supply</Strong>, <Strong>store_lp</Strong>,
        <Strong>take_for_mint</Strong>, and equivalent functions — but it cannot call arbitrary
        contracts, transfer funds to external addresses, or touch any other portfolio. One cap, one
        portfolio.
      </P>
      <H3>Expiry</H3>
      <P>
        The cap expires after <Strong>30 days</Strong>. Once expired, the keeper skips new deployments
        on this portfolio (it still settles existing positions). To continue, the user calls
        <Strong> refresh_policy</Strong> — a transaction signed by the original wallet that resets
        the expiry. This 30-day window is the natural kill switch: keeper access is never indefinite.
      </P>

      <H2>The authorization flow</H2>
      <OL>
        <LI>User configures strategy in Strategy Studio and clicks <Strong>Deploy</Strong></LI>
        <LI>User's wallet signs one transaction that creates the PolicyCap object with the configured budget, scope, and 30-day expiry</LI>
        <LI>The transaction transfers the PolicyCap to the keeper's address</LI>
        <LI>The keeper can now call keeper-gated entry functions on the vault, up to the cap's budget and before its expiry</LI>
        <LI>Every keeper action is on-chain and verifiable — the transaction digest is recorded in the cycle log</LI>
      </OL>
      <CodeBlock label="POLICY CAP OBJECT (MOVE)">
{`struct PolicyCap has key, store {
  id:              UID,
  portfolio_id:    ID,         // exactly one portfolio
  budget_remaining: u64,       // DUSDC units, decremented per cycle
  scope:           PolicyScope, // Predict-only
  expiry:          u64,        // epoch timestamp
}`}
      </CodeBlock>

      <H2>Revocation</H2>
      <P>
        The user can revoke keeper access at any time by destroying the PolicyCap. This is a single
        on-chain transaction from the original wallet. Revocation is immediate and absolute — the
        keeper loses access the moment the transaction confirms, with no cooldown or grace period.
      </P>
      <P>
        After revocation, existing positions in the vault remain intact and are still accessible.
        The user can redeem them directly via <Strong>redeem_permissionless</Strong> and withdraw
        their DUSDC at any time. Revocation does not affect the user's funds — it only removes the
        keeper's ability to submit new transactions.
      </P>
      <Callout type="info">
        The PolicyCap model is the core trust boundary between Sonark and the user. It means the
        platform never has unconstrained access to anyone's funds. The keeper can only act within a
        scope that the user defined, approved, and can cancel at any moment.
      </Callout>

      <H2>Per-portfolio isolation</H2>
      <P>
        Each portfolio has its own PolicyCap. If a user runs three portfolios simultaneously, they
        have three independent caps — each with its own budget ceiling and expiry. Revoking one cap
        does not affect the others. A compromised keeper key can only act on portfolios whose caps
        it holds — and only up to the budget on each.
      </P>

      <H2>Refreshing an expired cap</H2>
      <P>
        When the 30-day expiry passes:
      </P>
      <UL>
        <LI>Keeper detects the expired cap on the next cycle and skips deployment</LI>
        <LI>Dashboard shows a banner indicating the cap is expired</LI>
        <LI>User signs a <Strong>refresh_policy</Strong> transaction to create a new cap with a fresh expiry and (optionally) updated budget</LI>
        <LI>Keeper resumes automatically on the next cycle</LI>
      </UL>
    </DocPage>
  )
}
