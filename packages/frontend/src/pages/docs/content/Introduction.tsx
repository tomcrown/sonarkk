import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { getSectionForSlug } from '../docsNav'

export default function Introduction() {
  return (
    <DocPage
      section={getSectionForSlug('introduction')}
      title="Introduction"
      tagline="Automated strategy execution on DeepBook Predict."
    >
      <H2>What is Sonark?</H2>
      <P>
        Sonark is a no-code platform for building, deploying, and copying automated trading strategies
        on <Strong>DeepBook Predict</Strong> — a vol-surface-priced prediction protocol on Sui that
        prices every strike and expiry against a live SVI volatility surface with sub-hour settlement
        cycles. Sonark wraps that protocol with an automated keeper, risk controls, an on-chain
        permission model, and a copy-trading layer so users can participate without manually managing
        positions.
      </P>
      <P>
        Every Sonark strategy runs inside a <Strong>vault</Strong>: a smart contract that holds pooled
        DUSDC, mints composable share tokens on deposit, and delegates execution authority to a
        <Strong> keeper</Strong> via an on-chain PolicyCap object. The keeper settles prior positions,
        computes the next deployment size, and submits transactions every expiry cycle — automatically,
        with no wallet connection required after the initial deploy.
      </P>

      <H2>What is DeepBook Predict?</H2>
      <P>
        DeepBook Predict is a programmable prediction protocol live on Sui testnet. Unlike CLOB-matched
        event markets (Polymarket, Kalshi) that hand-list binary outcomes, Predict prices every strike
        and expiry against a calibrated SVI volatility surface. This makes it a real options-like
        market structure with:
      </P>
      <UL>
        <LI>Sub-hour rolling BTC expiries — cycles every 15–60 minutes on testnet</LI>
        <LI>A PLP vault that takes the other side of every trade, providing always-present liquidity</LI>
        <LI>On-chain LP economics: vault utilization, spread mechanics, and payouts are all auditable</LI>
        <LI>Composable primitives — positions plug into the wider Sui DeFi stack (margin, lending, structured vaults)</LI>
      </UL>
      <P>
        The quote asset is <Strong>DUSDC</Strong> (testnet only — not official USDC). Mainnet launch
        is planned; strategies built on Sonark are designed to redeploy on day one.
      </P>

      <H2>The two economic roles</H2>
      <P>
        Every participant on Predict takes one of two economic positions. Sonark makes this explicit
        and lets users choose which side they want to be on.
      </P>
      <H3>House — structural edge</H3>
      <P>
        House strategies <Strong>supply DUSDC to the PLP vault</Strong> and collect the spread on
        every prediction placed. The spread is priced by the SVI surface and floored at 0.5%, so
        house strategies earn regardless of which way BTC moves. This is the direction-agnostic side:
        the house wins by volume, not by being right about price.
      </P>
      <H3>Bettor — short-volatility view</H3>
      <P>
        Bettor strategies <Strong>mint range or binary positions</Strong> and pay the spread. They are
        profitable when BTC stays within a predicted range — a short-volatility bet. Bettor strategies
        have positive EV in calm markets and significantly negative EV at normal BTC volatility
        (40–80% annualized). They carry material risk and are labeled accordingly throughout the
        platform.
      </P>

      <H2>What Sonark adds</H2>
      <P>
        DeepBook Predict settles every 15–60 minutes. Without automation, a user would need to:
      </P>
      <UL>
        <LI>Watch for oracle settlement events</LI>
        <LI>Manually redeem their prior position</LI>
        <LI>Compute NAV, check vol conditions, and size the next deployment</LI>
        <LI>Submit a new on-chain transaction — within seconds of each oracle activation</LI>
        <LI>Manage the DeepBook Spot hedge for delta-sensitive strategies</LI>
      </UL>
      <P>
        The keeper does all of this. The user configures their strategy once, deposits once, and the
        bot runs every cycle — crash-safe, bounded by the PolicyCap, and fully verifiable on-chain.
      </P>

      <H2>Platform overview</H2>
      <UL>
        <LI><Strong>Strategy Studio</Strong> — configure any of the 7 strategies, set risk parameters, preview the vault setup</LI>
        <LI><Strong>Simulation Room</Strong> — backtest against real historical oracle and SVI data before deploying capital</LI>
        <LI><Strong>Dashboard</Strong> — real-time NAV, keeper cycle history, deployed positions, payout log</LI>
        <LI><Strong>Leaderboard</Strong> — on-chain performance across all public portfolios, verifiable by transaction hash</LI>
        <LI><Strong>Copy Trading</Strong> — mirror any public strategy in one transaction; private strategies encrypted with Seal</LI>
        <LI><Strong>Market Intel</Strong> — live SVI vol surface, PLP utilization, per-oracle health, BTC price feed</LI>
        <LI><Strong>Copilot</Strong> — AI assistant scoped to strategy selection and risk parameter tuning</LI>
      </UL>
    </DocPage>
  )
}
