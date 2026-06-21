import { DocPage, H2, H3, P, OL, UL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function QuickStart() {
  return (
    <DocPage
      section={getSectionForSlug('quick-start')}
      title="Quick Start"
      tagline="From zero to a running strategy in under five minutes."
    >
      <H2>1. Connect</H2>
      <P>
        Sonark supports two sign-in methods. Neither requires trusting Sonark with your private key.
      </P>
      <H3>Sui wallet</H3>
      <P>
        Connect any Sui-compatible wallet (Sui Wallet, Suiet, Backpack). Your wallet signs the
        initial Deploy transaction that creates the PolicyCap on-chain. After that, the keeper runs
        independently — your wallet does not need to stay connected.
      </P>
      <H3>Google (zkLogin)</H3>
      <P>
        Sign in with your Google account via zkLogin, powered by Mysten Labs Enoki. Sonark derives
        a Sui address from your OAuth credential using a zero-knowledge proof. No wallet extension
        required, no seed phrase to store. The signing key lives in your browser session; Sonark
        never sees it.
      </P>

      <H2>2. Get dUSDC</H2>
      <Callout type="info">
        dUSDC is the quote asset on DeepBook Predict testnet. It is not official USDC — it is a
        testnet-only asset minted for testing purposes. Request dUSDC from the DeepBook faucet before
        depositing into any strategy.
      </Callout>
      <P>
        Once connected, use the faucet link in the app to request testnet dUSDC. Amounts are credited
        directly to your wallet address. Each strategy vault accepts dUSDC deposits only.
      </P>

      <H2>3. Backtest first</H2>
      <P>
        Open <Strong>Simulation Room</Strong> from the sidebar. The backtest engine replays real
        historical oracle prices and SVI vol surfaces against the strategy's exact spread and payoff
        math — not simulated data. Before deploying capital, run a backtest to understand the
        strategy's historical drawdown profile and the conditions under which it underperforms.
      </P>
      <UL>
        <LI>Select a strategy type</LI>
        <LI>Set the same parameters you intend to use in production</LI>
        <LI>Review the NAV curve, drawdown, and vol regime breakdown</LI>
      </UL>

      <H2>4. Configure your strategy</H2>
      <P>
        Open <Strong>Strategy Studio</Strong> and select a strategy. Each strategy has a set of
        configurable risk parameters that shape how the keeper deploys each cycle:
      </P>
      <UL>
        <LI><Strong>Utilization target</Strong> — fraction of free balance deployed per cycle</LI>
        <LI><Strong>Liquidity reserve</Strong> — minimum DUSDC kept liquid at all times (never deployed)</LI>
        <LI><Strong>Drawdown pause</Strong> — keeper halts new deployments if NAV drops this far from peak</LI>
        <LI><Strong>Stop loss</Strong> — keeper permanently deactivates the portfolio below this NAV floor</LI>
      </UL>
      <P>
        See <Strong>Risk Parameters</Strong> for a full reference on every configurable option.
      </P>

      <H2>5. Deploy</H2>
      <P>
        Click <Strong>Deploy</Strong>. Your wallet signs one transaction that does two things:
      </P>
      <OL>
        <LI>Creates a <Strong>PolicyCap object</Strong> on-chain scoped to your portfolio, with your configured budget ceiling and a 30-day expiry</LI>
        <LI>Transfers the PolicyCap to the keeper's address, granting it permission to act on your behalf</LI>
      </OL>
      <P>
        From this point the keeper runs automatically. You receive <Strong>share tokens</Strong> in your
        wallet representing your proportional ownership of the vault.
      </P>

      <H2>6. Monitor and withdraw</H2>
      <P>
        The <Strong>Dashboard</Strong> shows NAV per share updated after each cycle, the full keeper
        cycle history with transaction hashes, active deployed positions, and any skip reasons (vol
        too low, budget exhausted, drawdown pause active).
      </P>
      <P>
        To withdraw: burn your share tokens at any time. The vault maintains a liquidity reserve
        so withdrawal is immediate unless the reserve is fully deployed (rare — the keeper is designed
        to keep the reserve intact). The vault always has a keeper-independent exit: if the keeper
        is down, you can still redeem positions and withdraw directly.
      </P>

      <H2>Policy refresh</H2>
      <P>
        PolicyCaps expire after 30 days. When the cap expires, the keeper stops opening new positions
        (it still settles existing ones). To continue, sign a <Strong>refresh_policy</Strong> transaction
        from your wallet to extend the cap. This is the built-in kill switch — you choose when to
        renew access.
      </P>
    </DocPage>
  )
}
