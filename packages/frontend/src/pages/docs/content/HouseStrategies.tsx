import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function HouseStrategies() {
  return (
    <DocPage
      section={getSectionForSlug('house-strategies')}
      title="House Strategies"
      tagline="Structural-edge strategies that collect the spread on every bet placed."
    >
      <Callout type="info">
        House strategies earn the spread rather than betting on price direction. Their performance
        correlates with trading volume and spread size — not with whether BTC goes up or down. They
        are regime-robust: backtesting shows positive results across low, normal, and high BTC vol
        environments. Historical APY figures from backtesting are modeled on assumed trader flow
        (testnet has no live volume) and should not be taken as expected returns.
      </Callout>

      <H2>Strategy 01 — PLP Supplier</H2>
      <H3>How it works</H3>
      <P>
        The keeper calls <Strong>predict::supply</Strong> each cycle, depositing the deployment
        amount into the Predict PLP (Prediction Liquidity Pool) vault. The PLP vault takes the other
        side of every binary and range prediction placed on the protocol. In exchange for providing
        this liquidity, suppliers receive the <Strong>spread</Strong> on every bet: the difference
        between what the bettor pays and the fair probability implied by the SVI surface.
      </P>
      <P>
        The spread formula is: <Strong>base_spread × √(p(1−p))</Strong> with a floor of 0.5%,
        multiplied by a utilization scalar (up to ×2 at full capacity). High-volatility environments
        generate wider spreads and higher income; low-vol environments generate narrower spreads but
        still positive.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>DeepBook Predict — predict::supply, predict::withdraw</LI>
      </UL>
      <H3>Best for</H3>
      <P>
        Conservative users who want direction-agnostic income from the Predict protocol. Simplest
        strategy — no hedge, no cross-protocol complexity.
      </P>

      <H2>Strategy 02 — Hedged PLP</H2>
      <H3>How it works</H3>
      <P>
        The PLP vault accumulates directional exposure based on the aggregate bets placed in it. If
        most bettors bet that BTC will be above a strike, the PLP is effectively short — it pays out
        if they're right. The Hedged PLP strategy offsets this exposure.
      </P>
      <P>
        Each cycle, after supplying to the PLP, the keeper reads the vault's net delta (the aggregate
        directional exposure from all open bets) and places an offsetting order on <Strong>DeepBook Spot</Strong>.
        If the vault is net short delta, the keeper buys BTC on Spot. If net long delta, it sells.
        The hedge size is proportional to the vault's utilization and the hedge multiplier parameter.
      </P>
      <P>
        The result is PLP spread income with the directional risk materially reduced. At normal to
        high vol (40%+), the hedge is most valuable because large BTC moves are most likely to
        trigger significant PLP payouts — exactly when the Spot hedge provides cover.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>DeepBook Predict — predict::supply</LI>
        <LI>DeepBook Spot — limit or market orders to offset pool delta</LI>
      </UL>
      <H3>Best for</H3>
      <P>
        Users who want the PLP spread income with reduced tail risk. More complex than PLP Supplier
        and carries basis risk (the Spot hedge is imperfect when BTC price jumps discontinuously),
        but historically shows better risk-adjusted returns at normal BTC volatility.
      </P>

      <H2>Strategy 03 — Smart Vault</H2>
      <H3>How it works</H3>
      <P>
        The Smart Vault auto-allocates across PLP Supplier and Hedged PLP based on the current vol
        regime. When implied vol (ATM SVI) is low, it allocates more to pure PLP supply (spread
        income dominates, hedge cost is wasted). When implied vol is high, it shifts allocation
        toward Hedged PLP (hedge value increases with larger expected BTC moves).
      </P>
      <P>
        Rebalancing happens each cycle — the keeper reads the current ATM vol, applies the allocation
        formula, and deploys accordingly. Users set one configuration and the vault self-adjusts.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>DeepBook Predict — predict::supply</LI>
        <LI>DeepBook Spot — delta hedge (when high-vol weighting is active)</LI>
      </UL>
      <H3>Best for</H3>
      <P>
        The recommended default for most users who want house-side exposure without manually managing
        which house strategy to run. It is the simplest operational choice with the most adaptive
        risk posture.
      </P>

      <H2>Strategy 04 — Principal Protected</H2>
      <H3>How it works</H3>
      <P>
        The principal — the user's DUSDC deposit — is placed entirely into a <Strong>money market
        lending protocol</Strong> (Iron Bank on mainnet; mocked with real logic on testnet). The
        principal earns a base lending yield and never touches DeepBook Predict. Only the
        <Strong> accumulated yield</Strong> from the lending position is periodically harvested and
        deployed into Predict as a PLP supply or range position.
      </P>
      <P>
        Because the principal sits in lending and not in Predict, it cannot be lost to Predict outcomes.
        The worst case is: lending yield goes to Predict, Predict outcomes are negative, user ends up
        with their original principal plus a smaller-than-expected yield. The principal is never at risk.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>Iron Bank / money market — principal deposit, yield harvest</LI>
        <LI>DeepBook Predict — yield deployed as PLP supply or mint</LI>
      </UL>
      <H3>Testnet note</H3>
      <P>
        Iron Bank is mainnet-only. On testnet, Sonark mocks the lending leg with the same interface
        and correct yield math. The mock accrues a realistic interest rate on the principal and
        makes the harvested yield available to the keeper exactly as the mainnet version would.
        The Predict leg runs live on testnet.
      </P>

      <H2>Strategy 05 — Margin Loop</H2>
      <H3>How it works</H3>
      <P>
        The Margin Loop is a three-protocol composability strategy: the user's DUSDC is posted as
        collateral to <Strong>Iron Bank</Strong>, which issues a credit line; the keeper draws from
        that credit line on <Strong>deepbook_margin</Strong> to borrow additional DUSDC; the
        borrowed capital is then deployed into <Strong>DeepBook Predict</Strong> (PLP supply or
        range positions). Settlement payouts from Predict repay the borrow.
      </P>
      <P>
        This creates leveraged exposure to the PLP spread. At moderate LTV ratios, the borrow cost
        (Iron Bank interest rate) is outpaced by the spread income from the larger Predict position.
        Leverage amplifies both gains and losses.
      </P>
      <H3>Protocols used</H3>
      <UL>
        <LI>Iron Bank — collateral deposit, credit issuance</LI>
        <LI>deepbook_margin — borrow execution, LTV management</LI>
        <LI>DeepBook Predict — deployment of borrowed capital</LI>
      </UL>
      <H3>Risk note</H3>
      <P>
        If Predict outcomes are sufficiently negative and the borrow is not repaid, the margin
        position can approach the liquidation threshold. The keeper monitors LTV each cycle and will
        deleverage (reduce the Predict position) before reaching the liquidation threshold. Stop-loss
        parameters are especially important for this strategy.
      </P>
      <Callout type="warning">
        The Margin Loop involves borrowed capital. Losses can exceed the original deposit in extreme
        scenarios. Configure stop-loss and drawdown-pause parameters carefully before deploying.
      </Callout>
    </DocPage>
  )
}
