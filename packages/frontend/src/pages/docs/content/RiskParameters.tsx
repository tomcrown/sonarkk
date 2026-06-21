import { DocPage, H2, H3, P, UL, LI, Strong, Table, THead, TBody, TR, TH, TD } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function RiskParameters() {
  return (
    <DocPage
      section={getSectionForSlug('risk-parameters')}
      title="Risk Parameters"
      tagline="Configuration options that control how much and when the keeper deploys."
    >
      <P>
        Risk parameters are set per-portfolio at deploy time and can be updated via a wallet
        transaction (which does not require revoking and re-creating the PolicyCap). Every parameter
        shapes the keeper's behavior directly — there is no interpretation layer between the parameter
        and the on-chain action.
      </P>

      <H2>Quick reference</H2>
      <Table>
        <THead>
          <TR>
            <TH>Parameter</TH>
            <TH>Applies to</TH>
            <TH>Default</TH>
          </TR>
        </THead>
        <TBody>
          <TR><TD>Utilization target</TD><TD>All strategies</TD><TD>25%</TD></TR>
          <TR><TD>Liquidity reserve</TD><TD>All strategies</TD><TD>20%</TD></TR>
          <TR><TD>Strike selection</TD><TD>Range Roll, Vol-Targeted Range</TD><TD>ATM</TD></TR>
          <TR><TD>Drawdown pause</TD><TD>All strategies</TD><TD>15%</TD></TR>
          <TR><TD>Stop loss</TD><TD>All strategies</TD><TD>Off</TD></TR>
          <TR><TD>Vol target</TD><TD>Vol-Targeted Range only</TD><TD>25%</TD></TR>
          <TR><TD>Hedge multiplier</TD><TD>Hedged PLP only</TD><TD>1.0×</TD></TR>
        </TBody>
      </Table>

      <H2>Utilization target</H2>
      <P>
        The fraction of <Strong>free balance</Strong> (vault balance minus liquidity reserve) that the
        keeper deploys each cycle.
      </P>
      <H3>How the keeper uses it</H3>
      <P>
        On each cycle: <Strong>deploy_amount = (vault_balance − reserve) × utilization_target</Strong>.
        This is the DUSDC sent into the Predict call (supply, mint_range, etc.).
      </P>
      <H3>Trade-offs</H3>
      <UL>
        <LI>Higher util (50–80%) → more capital working per cycle → more income at risk per cycle</LI>
        <LI>Lower util (10–25%) → smaller exposure per cycle → more cycles needed to fully deploy</LI>
        <LI>Spreading across cycles (lower util) is safer: one bad expiry only affects the deployed slice, not the full balance</LI>
      </UL>

      <H2>Liquidity reserve</H2>
      <P>
        The minimum fraction of vault balance the keeper will <Strong>never deploy</Strong>. This
        fraction is always available for immediate withdrawal.
      </P>
      <H3>How the keeper uses it</H3>
      <P>
        Before computing deploy_amount, the keeper subtracts the reserve:
        <Strong> available = vault_balance × (1 − reserve_pct)</Strong>. The reserve is a hard floor
        — the keeper will under-deploy rather than touch it.
      </P>
      <H3>Trade-offs</H3>
      <UL>
        <LI>Higher reserve (30–50%) → more always-liquid DUSDC → safer withdrawal experience, less capital deployed</LI>
        <LI>Lower reserve (5–10%) → more capital deployed → higher income, but withdrawals above the reserve require waiting for a settlement</LI>
        <LI>Reserve of 0% is technically valid but means all deployed capital must settle before a full withdrawal is possible</LI>
      </UL>

      <H2>Strike selection</H2>
      <P>
        Applies to <Strong>Range Roll and Vol-Targeted Range</Strong> only. Determines how the
        keeper positions the range around the current BTC price.
      </P>
      <Table>
        <THead>
          <TR>
            <TH>Option</TH>
            <TH>Range width</TH>
            <TH>Win probability</TH>
            <TH>Payout if BTC stays inside</TH>
          </TR>
        </THead>
        <TBody>
          <TR><TD>ATM</TD><TD>Tight — close to current price</TD><TD>Higher</TD><TD>Lower (spread is wider)</TD></TR>
          <TR><TD>OTM_1</TD><TD>Medium</TD><TD>Medium</TD><TD>Medium</TD></TR>
          <TR><TD>OTM_2</TD><TD>Wide</TD><TD>Lower</TD><TD>Higher (spread is narrower)</TD></TR>
        </TBody>
      </Table>
      <P>
        ATM maximizes the probability of finishing in-range at the cost of a wider spread. OTM
        variants give a larger payout when BTC is within range but lose more often. The expected
        value across all options is negative (you pay the spread); strike selection is a preference
        about how that loss is distributed across cycles.
      </P>

      <H2>Drawdown pause</H2>
      <P>
        The maximum NAV drawdown from peak (expressed as a percentage) before the keeper halts new
        deployments. The keeper continues to <Strong>settle existing positions</Strong> — it only
        stops opening new ones.
      </P>
      <H3>How the keeper uses it</H3>
      <P>
        Each cycle: <Strong>current_drawdown = (peak_nav − current_nav) / peak_nav</Strong>. If this
        exceeds the threshold, the keeper records a skip with reason "drawdown_pause" and moves on
        to the next portfolio. The pause lifts automatically when NAV recovers above the threshold.
      </P>
      <Callout type="info">
        Drawdown pause is a <Strong>deployment pause</Strong> — not a withdrawal freeze. The user can
        always withdraw during a drawdown pause. Existing settled positions still receive their payouts.
      </Callout>

      <H2>Stop loss</H2>
      <P>
        An absolute NAV floor. If NAV falls below this value, the keeper <Strong>permanently
        deactivates</Strong> the portfolio — no more deployments, no recovery mode. This is a
        one-way gate: once triggered, the portfolio must be manually re-enabled via a wallet
        transaction.
      </P>
      <H3>When to use it</H3>
      <UL>
        <LI>Margin Loop (required — leverage can accelerate losses past the drawdown pause)</LI>
        <LI>Bettor strategies (recommended — prevents the strategy from compounding losses across many expiries)</LI>
        <LI>House strategies (optional — PLP losses are structurally bounded, but useful as a hard floor)</LI>
      </UL>

      <H2>Vol target</H2>
      <P>
        <Strong>Vol-Targeted Range only.</Strong> The reference ATM vol the strategy sizes to. When
        live implied vol exceeds the target, position size is scaled down: smaller exposure in
        high-vol environments where the short-vol bet is most likely to lose.
      </P>
      <P>
        A target of 25% means: at 25% implied vol, deploy the full utilization-target amount. At
        50% implied vol, deploy half. At 12.5% (below min floor of 28%), the cycle is skipped
        entirely.
      </P>

      <H2>Hedge multiplier</H2>
      <P>
        <Strong>Hedged PLP only.</Strong> Scales the size of the DeepBook Spot hedge relative to
        the computed net delta of the PLP vault. A multiplier of 1.0× means full hedge (offset 100%
        of measured delta). 0.5× means partial hedge. 1.5× means over-hedging (net short delta
        from the Spot position after full delta offset).
      </P>
      <P>
        The optimal multiplier depends on how accurately the vault's net delta can be measured.
        At 1.0× the strategy is market-neutral in theory; in practice, the delta estimate has
        measurement error and some directional residual remains. Most users leave this at 1.0×.
      </P>
    </DocPage>
  )
}
