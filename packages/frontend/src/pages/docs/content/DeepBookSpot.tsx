import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { getSectionForSlug } from '../docsNav'

export default function DeepBookSpot() {
  return (
    <DocPage
      section={getSectionForSlug('deepbook-spot')}
      title="DeepBook Spot"
      tagline="The order book used for delta hedging in house strategies."
    >
      <H2>Why Spot is needed</H2>
      <P>
        The PLP vault accumulates directional exposure from the aggregate of all open bets. If more
        DUSDC has been wagered on BTC being <Strong>above</Strong> a strike, the PLP vault is
        effectively short — it pays out if those bettors are right. This net directional exposure
        is the PLP's delta: how much the vault's value changes per dollar move in BTC price.
      </P>
      <P>
        For PLP Supplier, this delta is accepted as-is. For <Strong>Hedged PLP</Strong> and
        <Strong> Smart Vault</Strong>, the keeper offsets this delta every cycle by placing a
        corresponding order on <Strong>DeepBook Spot</Strong> — the on-chain central limit order
        book for BTC/USDC on Sui.
      </P>

      <H2>How the hedge works</H2>
      <H3>1. Compute net delta</H3>
      <P>
        After supplying to the PLP, the keeper reads the vault's current net exposure from on-chain
        Predict state. This gives the estimated delta: if the vault is net short 0.5 BTC delta, a
        +1 USD move in BTC reduces the vault's value by $0.50.
      </P>
      <CodeBlock label="DELTA COMPUTATION">
{`net_delta = sum over all open positions in vault:
  position_delta(strike, direction, probability, notional)

hedge_amount_btc = net_delta × hedge_multiplier`}
      </CodeBlock>
      <H3>2. Place the Spot order</H3>
      <P>
        The keeper submits a market or limit order on DeepBook Spot to offset the measured delta.
        If the vault is net short 0.5 BTC, the keeper buys 0.5 BTC on Spot. At expiry, if BTC
        moves up $1,000 and the vault's PLP position lost $500, the Spot long gained approximately
        $500 — net hedge coverage.
      </P>
      <H3>3. Unwind at expiry</H3>
      <P>
        Before or after settlement, the keeper closes the Spot hedge position (sells the BTC back).
        The combined PnL of the PLP settlement and the Spot unwind determines the cycle's net result.
      </P>

      <H2>Hedge coverage and basis risk</H2>
      <P>
        The delta computed from PLP state is an estimate — it depends on assumptions about how
        bettors' positions aggregate across the pool. Two sources of basis risk exist:
      </P>
      <UL>
        <LI><Strong>Estimation error</Strong> — the computed delta may not perfectly match the vault's true sensitivity to BTC price</LI>
        <LI><Strong>Discrete jump risk</Strong> — if BTC price jumps discontinuously (a "gap"), the hedge placed before the jump may not fully cover the PLP loss at the new price</LI>
      </UL>
      <P>
        At moderate BTC movements the hedge is highly effective. At extreme intraday jumps (rare),
        residual directional exposure from estimation error and gaps is present. The hedge significantly
        reduces expected drawdown but does not eliminate it.
      </P>

      <H2>DeepBook Spot on testnet and mainnet</H2>
      <P>
        Unlike DeepBook Predict (testnet only), <Strong>DeepBook Spot is live on both Sui testnet
        and mainnet</Strong>. No mock is needed for the Spot leg of the Hedged PLP strategy — the
        keeper submits real orders against a real order book. Liquidity on testnet is thinner than
        mainnet; the hedge is less efficiently filled on testnet but follows the same code path.
      </P>

      <H2>Coverage ratio</H2>
      <P>
        The keeper logs the <Strong>coverage ratio</Strong> each cycle: the percentage of the
        measured net delta that was successfully offset by the Spot order. 100% coverage = full
        theoretical hedge. Shortfalls occur when Spot liquidity is insufficient to fill the full
        hedge size at a reasonable price, or when the order is partially filled.
      </P>
      <P>
        The keeper terminal on the landing page shows an example: <em>"hedge PTB · DeepBook Spot ·
        sell 0.0021 BTC · 94% coverage."</em> A 94% coverage ratio means 6% of the measured delta
        remains unhedged — typical at normal testnet liquidity.
      </P>
    </DocPage>
  )
}
