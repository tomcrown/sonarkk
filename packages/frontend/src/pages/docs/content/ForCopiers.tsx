import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function ForCopiers() {
  return (
    <DocPage
      section={getSectionForSlug('for-copiers')}
      title="For Copiers"
      tagline="Mirror any public strategy with on-chain verifiable performance."
    >
      <H2>What copy trading gives you</H2>
      <P>
        Copying a strategy on Sonark creates a new portfolio in <Strong>your own wallet</Strong>,
        running the exact same strategy configuration as the original. The same keeper cycle runs
        for your portfolio. Payouts and losses land in your vault. The original creator has no access
        to your funds.
      </P>
      <P>
        Unlike social trading platforms where you trust claimed performance numbers, every Sonark
        result is a Sui transaction on-chain. You can verify any cycle, any payout, and any drawdown
        using the Sui explorer before copying.
      </P>

      <H2>How to find strategies</H2>
      <P>
        Open the <Strong>Leaderboard</Strong> from the sidebar. All public strategies are listed with:
      </P>
      <UL>
        <LI>Strategy type and protocol tags</LI>
        <LI>NAV performance history — the on-chain record of keeper cycles</LI>
        <LI>Drawdown high-water mark</LI>
        <LI>Number of active copiers</LI>
        <LI>Creator address and on-chain portfolio ID</LI>
      </UL>
      <P>
        For private strategies (encrypted with Seal), the entry appears on the leaderboard with
        performance metrics visible but configuration hidden. To access the config you need to
        purchase a <Strong>CopyAccessTicket</Strong>.
      </P>

      <H2>Copying a public strategy</H2>
      <OL>
        <LI>Find a strategy on the Leaderboard and open its detail page</LI>
        <LI>Click <Strong>Copy Strategy</Strong></LI>
        <LI>Set your own deposit amount and risk parameters (you can adjust utilization target, reserve, drawdown pause, and stop loss independently — these are yours)</LI>
        <LI>Review the strategy configuration (visible for public strategies)</LI>
        <LI>Sign the deployment transaction — this creates your PolicyCap and your vault</LI>
      </OL>
      <P>
        Your portfolio starts running immediately on the next oracle cycle. Your deposit size and
        risk parameters are independent — the strategy type and configuration are copied, but
        how much you risk per cycle is your decision.
      </P>

      <H2>Copying a private strategy</H2>
      <OL>
        <LI>Open the private strategy's detail page on the Leaderboard</LI>
        <LI>Click <Strong>Purchase Access</Strong> and pay the creator's copy fee in DUSDC (one-time)</LI>
        <LI>Your wallet receives a <Strong>CopyAccessTicket</Strong> — an on-chain object proving you paid for access</LI>
        <LI>Sonark's Seal key servers verify the ticket against the on-chain proof and decrypt the strategy configuration to your session</LI>
        <LI>Configure your deposit and risk parameters, then deploy as normal</LI>
      </OL>
      <P>
        The decrypted configuration is used to initialize your vault. After initialization, your
        vault runs independently — you do not need continued access to the original config.
      </P>
      <Callout type="info">
        The copy fee is paid once to the creator. It does not recur. There are no ongoing fees from
        Sonark for running a copied strategy.
      </Callout>

      <H2>What gets copied, what doesn't</H2>
      <H3>Copied from the original</H3>
      <UL>
        <LI>Strategy type (PLP Supplier, Hedged PLP, Range Roll, etc.)</LI>
        <LI>Strategy configuration (strike selection, hedge multiplier, vol target if applicable)</LI>
        <LI>The keeper logic — your portfolio runs the same code path as the original</LI>
      </UL>
      <H3>Set independently by you</H3>
      <UL>
        <LI>Deposit amount — your capital, fully independent</LI>
        <LI>Utilization target — you decide how much of your balance deploys per cycle</LI>
        <LI>Liquidity reserve — your withdrawal floor</LI>
        <LI>Drawdown pause threshold — your personal stop</LI>
        <LI>Stop loss — your hard floor</LI>
        <LI>PolicyCap budget ceiling — set by your wallet at deploy time</LI>
      </UL>

      <H2>Performance verification</H2>
      <P>
        Every keeper cycle produces a Sui transaction digest. From the strategy detail page, click
        any cycle entry to open the transaction on the Sui explorer. You can verify:
      </P>
      <UL>
        <LI>The exact Predict contract call made (supply, mint_range, etc.)</LI>
        <LI>The DUSDC amounts in and out</LI>
        <LI>The on-chain timestamp</LI>
        <LI>The settlement payout (for settled cycles)</LI>
      </UL>
      <P>
        Performance on the Leaderboard is computed from this on-chain data — not self-reported by
        the creator. If a strategy shows a 12% drawdown, that drawdown happened on-chain and is
        independently verifiable.
      </P>
    </DocPage>
  )
}
