import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function BettorStrategies() {
  return (
    <DocPage
      section={getSectionForSlug('bettor-strategies')}
      title="Bettor Strategies"
      tagline="Short-volatility strategies that profit in calm markets."
    >
      <Callout type="warning">
        Bettor strategies are <Strong>short-volatility bets</Strong>. They are profitable when BTC
        stays within a predicted price range and lose money when BTC moves violently. At normal BTC
        volatility (40–80% annualized), backtesting shows significant negative returns. These
        strategies are appropriate for users with a specific short-vol market view — not as a
        general-purpose income strategy. Positive results from backtesting reflect a calm-vol test
        window only (approximately 27% annualized) and are not representative of typical BTC market
        conditions.
      </Callout>

      <H2>How bettor strategies work</H2>
      <P>
        Bettor strategies call <Strong>predict::mint_range</Strong> to open a range position on the
        BTC price. A range position pays out a fixed amount if BTC settles inside the chosen price
        range at expiry. It pays out nothing if BTC settles outside the range. The cost of the
        position (the premium) is the spread charged by the PLP vault at entry.
      </P>
      <P>
        The keeper opens a new range position each expiry cycle, sized by the utilization target.
        At settlement, the payout (if any) is automatically redeemed and the proceeds re-deployed
        in the next cycle.
      </P>
      <P>
        Both bettor strategies pay the spread on every trade. Spread cost is the structural
        headwind: the expected value of any bet is negative before accounting for edge. Bettor
        strategies only have positive EV if BTC behaves more calmly than the SVI surface implies —
        specifically, if realized vol is below implied vol.
      </P>

      <H2>Strategy 06 — Range Roll</H2>
      <H3>How it works</H3>
      <P>
        Each cycle the keeper selects a price range around the current BTC ATM strike, calls
        <Strong> predict::mint_range</Strong>, and holds until expiry. At settlement it redeems
        and re-deploys. The range is defined by the <Strong>strike selection</Strong> parameter:
        ATM places the range tightly around the current price for the highest payout probability;
        OTM variants widen the range for a smaller payout at higher probability.
      </P>
      <P>
        There is no vol adjustment — Range Roll deploys the same fraction of the balance every cycle
        regardless of the current implied vol. This makes it the simplest bettor strategy to understand
        but also the most exposed to vol spikes: a large BTC move in any direction causes the
        position to expire worthless and the spread cost is lost.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>DeepBook Predict — predict::mint_range, predict::redeem_range</LI>
      </UL>
      <H3>Break-even condition</H3>
      <P>
        Range Roll has positive EV only when realized BTC volatility is meaningfully below the
        implied vol embedded in the SVI surface. If realized vol matches or exceeds implied vol, the
        strategy is expected to break even or lose. The spread cost ensures the break-even is always
        slightly below implied vol.
      </P>

      <H2>Strategy 07 — Vol-Targeted Range</H2>
      <H3>How it works</H3>
      <P>
        Vol-Targeted Range is identical to Range Roll in mechanism (calls mint_range each cycle,
        redeems on settlement) with one key difference: the position size scales inversely with the
        current ATM implied vol. When implied vol is high, the keeper deploys a smaller fraction
        of the available balance. When implied vol is low, it deploys more.
      </P>
      <CodeBlock>
{`scale_factor = vol_target / current_atm_vol
deploy_amount = base_amount × min(scale_factor, 1.0)`}
      </CodeBlock>
      <P>
        This means the strategy automatically reduces exposure in high-vol environments — exactly
        when range positions are most likely to expire worthless. It does not eliminate the short-vol
        risk; it manages the position size to limit how much is lost in a vol spike.
      </P>
      <H3>Comparison to Range Roll</H3>
      <UL>
        <LI>Same protocols, same contract calls</LI>
        <LI>Materially reduced tail loss in high-vol environments (backtesting: −1,287% vs. −44,724% at normal BTC vol — both deeply negative)</LI>
        <LI>Preferred over Range Roll in all cases where a bettor strategy is used — the vol-scaling adds meaningful risk management at no structural cost</LI>
        <LI>Vol target parameter must be set; if unset, defaults to 25% ATM vol</LI>
      </UL>
      <H3>Protocols used</H3>
      <UL>
        <LI>DeepBook Predict — predict::mint_range, predict::redeem_range</LI>
        <LI>Predict SVI oracle — ATM vol read each cycle for position sizing</LI>
      </UL>

      <Callout type="warning">
        Neither Range Roll nor Vol-Targeted Range includes a mechanism for buying vol or hedging
        the short-vol exposure. If you believe BTC will be volatile, these strategies are not
        appropriate. Consider house strategies instead — they profit from vol, not from calm.
      </Callout>
    </DocPage>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-border/60 my-6" style={{ background: '#09090B' }}>
      <pre className="p-5 overflow-x-auto">
        <code className="font-mono text-[13px] text-foreground/80 leading-relaxed whitespace-pre">
          {children}
        </code>
      </pre>
    </div>
  )
}
