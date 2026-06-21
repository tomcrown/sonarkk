import { DocPage, H2, H3, P, UL, LI, Strong, Table, THead, TBody, TR, TH, TD } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function DeepBookPredict() {
  return (
    <DocPage
      section={getSectionForSlug('deepbook-predict')}
      title="DeepBook Predict"
      tagline="The vol-surface-priced prediction protocol that Sonark strategies run on."
    >
      <H2>What is DeepBook Predict?</H2>
      <P>
        DeepBook Predict is a programmable prediction protocol on Sui that prices binary and range
        outcomes against a calibrated SVI (Stochastic Volatility Inspired) volatility surface. It
        is designed as a real piece of DeFi market structure — not an event betting app — with:
      </P>
      <UL>
        <LI>Sub-hour rolling BTC expiries (15–60 minute cycles on testnet)</LI>
        <LI>Every strike and expiry priced against a live vol surface (not hand-listed)</LI>
        <LI>A PLP vault that is always the counterparty — liquidity is always present</LI>
        <LI>On-chain LP economics that are fully auditable and composable</LI>
        <LI>Permissionless primitives — anyone can build vaults, keepers, and structured products on top</LI>
      </UL>
      <Callout type="info">
        DeepBook Predict is live on Sui <Strong>testnet only</Strong>. The quote asset is
        <Strong> dUSDC</Strong> — a testnet-only asset, not official USDC. Mainnet launch is planned;
        Sonark strategies are built to redeploy on day one.
      </Callout>

      <H2>The SVI volatility surface</H2>
      <P>
        Predict prices outcomes using the SVI (Stochastic Volatility Inspired) parametric model —
        the same model widely used in professional options markets. For each active oracle (expiry),
        the Mysten Labs SVI calibration service publishes a fresh set of SVI parameters:
      </P>
      <CodeBlock label="SVI PARAMS (OracleSVIUpdated event)">
{`{
  a, b, rho, m, sigma,  // raw SVI parameters
  atm_vol,              // implied vol at the at-the-money strike
  forward_price,        // BTC forward price for this expiry
  expiry_timestamp
}`}
      </CodeBlock>
      <P>
        From these parameters, the Predict contract computes the fair probability of any binary
        outcome (above/below a strike) and the fair payoff of any range outcome. The spread charged
        to bettors is applied on top of these fair values.
      </P>
      <P>
        Sonark reads the live SVI parameters from the <Strong>predict-server</Strong> oracle feed
        (predict-server.testnet.mystenlabs.com) each keeper cycle to make deployment decisions and
        to enforce vol floor checks.
      </P>

      <H2>The PLP vault</H2>
      <P>
        The Prediction Liquidity Pool (PLP) vault is the always-present counterparty for every bet
        placed on Predict. When a bettor mints a binary or range position, the PLP takes the other
        side. LP suppliers (Sonark house strategies) deposit DUSDC into the PLP and receive LP tokens
        representing their proportional ownership.
      </P>
      <H3>PLP economics</H3>
      <UL>
        <LI>Spread income — LPs earn the spread on every bet. Spread = <Strong>base_spread × √(p(1−p))</Strong>, floor 0.5%, capped by a utilization multiplier of ×2</LI>
        <LI>Utilization exposure — the vault accumulates net exposure from all open positions. High utilization can result in large payouts to bettors if BTC moves sharply</LI>
        <LI>Withdrawal limiter — token-bucket mechanism prevents rapid large withdrawals that would drain the vault mid-cycle</LI>
        <LI>Liability cap — vault exposure is capped at max_total_exposure_pct (80%) of vault balance</LI>
      </UL>

      <H2>Contract entry points Sonark uses</H2>
      <Table>
        <THead>
          <TR>
            <TH>Function</TH>
            <TH>Caller</TH>
            <TH>Used by</TH>
          </TR>
        </THead>
        <TBody>
          <TR><TD>predict::supply</TD><TD>Keeper (PolicyCap gated)</TD><TD>PLP Supplier, Hedged PLP, Smart Vault</TD></TR>
          <TR><TD>predict::withdraw</TD><TD>Keeper</TD><TD>All house strategies — redeem LP tokens</TD></TR>
          <TR><TD>predict::mint</TD><TD>Keeper</TD><TD>Principal Protected — mint binary on accumulated yield</TD></TR>
          <TR><TD>predict::mint_range</TD><TD>Keeper</TD><TD>Range Roll, Vol-Targeted Range</TD></TR>
          <TR><TD>predict::redeem</TD><TD>Keeper</TD><TD>Settle settled positions (own portfolio)</TD></TR>
          <TR><TD>predict::redeem_permissionless</TD><TD>Anyone</TD><TD>Keeper settles; user can also call directly</TD></TR>
          <TR><TD>predict::get_trade_amounts</TD><TD>Keeper (read)</TD><TD>Price check before deployment</TD></TR>
          <TR><TD>predict::vault_value</TD><TD>Keeper (read)</TD><TD>NAV computation</TD></TR>
          <TR><TD>predict::ask_bounds</TD><TD>Keeper (read)</TD><TD>Strike selection for range strategies</TD></TR>
        </TBody>
      </Table>

      <H2>Positions and the PredictManager</H2>
      <P>
        Each Sonark vault owns a <Strong>PredictManager</Strong> object — a Move object that holds
        all open Predict positions (binary, range, and PLP LP tokens) for that vault. Positions are
        keyed by MarketKey or RangeKey (not NFTs) and live inside the PredictManager. The keeper
        reads and writes the PredictManager through keeper-gated vault functions.
      </P>

      <H2>The oracle settlement model</H2>
      <P>
        At the end of each expiry window, the Predict oracle publishes a settlement price for BTC.
        All open binary and range positions for that expiry resolve immediately:
      </P>
      <UL>
        <LI>Binary above/below positions: payout if BTC settled above/below the strike; zero otherwise</LI>
        <LI>Range positions: payout if BTC settled inside the range; zero otherwise</LI>
        <LI>PLP LP positions: value adjusts based on aggregate payouts made to bettors (PLP wins when bettors lose, and vice versa)</LI>
      </UL>
      <P>
        Settlement is permissionless — anyone can call <Strong>redeem_permissionless</Strong> to
        claim a settled position's payout. The keeper does this automatically; users can also do it
        directly.
      </P>
    </DocPage>
  )
}
