import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function MarginLoop() {
  return (
    <DocPage
      section={getSectionForSlug('margin-loop')}
      title="Margin Loop"
      tagline="Leveraged PLP exposure through a three-protocol borrow-and-deploy cycle."
    >
      <Callout type="warning">
        The Margin Loop involves borrowed capital. Losses can exceed your original deposit in extreme
        scenarios. This strategy is for users who understand leverage and have configured stop-loss
        and drawdown-pause parameters carefully. If you are unsure, start with PLP Supplier or
        Smart Vault.
      </Callout>

      <H2>The core idea</H2>
      <P>
        Every other Sonark house strategy deploys only the capital you deposited. The Margin Loop
        goes further: it uses your deposit as collateral to borrow additional DUSDC, then deploys
        both your capital and the borrowed capital into DeepBook Predict. The result is a
        <Strong> leveraged position on the PLP spread</Strong> — the same structural edge as PLP
        Supplier, but amplified.
      </P>
      <P>
        The economic case is straightforward: at moderate loan-to-value ratios, the PLP spread
        income earned on the larger Predict position exceeds the borrow interest charged by the
        lending protocol. The difference is net profit on top of what you would have earned
        unlevered. When Predict outcomes are poor, however, the borrow cost continues accruing
        and losses compound faster than in an unlevered position.
      </P>

      <H2>Three-protocol execution chain</H2>
      <P>
        Each keeper cycle executes a chain across three protocols in a single Programmable
        Transaction Block (PTB):
      </P>
      <OL>
        <LI>
          <Strong>Iron Bank — collateral deposit.</Strong> Your DUSDC is posted as collateral to
          Iron Bank, the permissioned money market on Sui. Iron Bank issues a credit line based
          on the collateral ratio it applies to DUSDC.
        </LI>
        <LI>
          <Strong>deepbook_margin — borrow execution.</Strong> The keeper draws from the Iron Bank
          credit line via the deepbook_margin module, borrowing additional DUSDC up to the
          configured LTV ceiling. The borrowed amount depends on the credit line size and the
          leverage ratio you set.
        </LI>
        <LI>
          <Strong>DeepBook Predict — deployment.</Strong> The combined capital (your deposit +
          borrowed DUSDC) is supplied to the Predict PLP vault or deployed into range positions.
          Settlement payouts cycle back and are used to service the borrow repayment.
        </LI>
      </OL>
      <CodeBlock label="CYCLE FLOW">
{`deposit (DUSDC)
  → Iron Bank collateral  →  credit line issued
  → deepbook_margin borrow  →  borrowed DUSDC
  → combined capital → predict::supply / mint_range
  → expiry settles  →  payout returned
  → borrow serviced  →  net P&L to vault`}
      </CodeBlock>

      <H2>LTV management and the keeper's safety role</H2>
      <P>
        The keeper monitors the loan-to-value ratio every cycle. If Predict outcomes are
        negative over several cycles and the collateral-to-borrow ratio deteriorates, the
        keeper acts before the liquidation threshold is reached:
      </P>
      <UL>
        <LI>Reduces the Predict position size in the next cycle</LI>
        <LI>Directs a larger fraction of available balance toward repaying the borrow</LI>
        <LI>Suspends new deployments until LTV returns to a safe band</LI>
      </UL>
      <P>
        This deleveraging is automatic — you do not need to monitor the LTV yourself. However,
        if BTC moves very sharply in a single cycle, the keeper may not be able to deleverage
        fast enough to prevent a liquidation. This is the primary tail risk of the Margin Loop.
      </P>

      <H2>Key configuration parameters</H2>
      <P>
        The standard risk parameters all apply to Margin Loop — but their importance is elevated
        because leverage amplifies every outcome. Configure these before deploying:
      </P>
      <H3>Stop loss (critical)</H3>
      <P>
        Sets an absolute NAV floor. If NAV falls below it, the keeper permanently deactivates the
        portfolio and begins unwinding — reducing the Predict position and repaying the borrow.
        For Margin Loop, set this tighter than you would for unlevered strategies. A stop-loss at
        −15% to −20% from entry is a reasonable starting point for 1.5× leverage.
      </P>
      <H3>Drawdown pause</H3>
      <P>
        Pauses new deployments when NAV drawdown from peak exceeds the threshold. The borrow
        continues to accrue but no new Predict capital is deployed. Gives the keeper time to
        assess conditions before re-entering.
      </P>
      <H3>Leverage ratio / LTV ceiling</H3>
      <P>
        Determines how much is borrowed relative to your collateral. 1.5× means your $100 deposit
        borrows $50 and deploys $150 to Predict. Higher leverage = higher upside and higher
        downside. Start at 1.3×–1.5×; only increase if you understand the liquidation dynamics.
      </P>

      <H2>Testnet vs mainnet</H2>
      <P>
        Both Iron Bank and deepbook_margin are <Strong>mainnet-only protocols</Strong>. On testnet,
        Sonark runs a mock that replicates the borrow mechanics: the mock issues a credit line,
        tracks the borrow balance, accrues interest at a realistic rate, and handles repayment
        exactly as the mainnet contracts would. The Predict leg runs live on testnet. This means
        you can test and observe Margin Loop behavior on testnet, but the lending leg is simulated.
      </P>
      <Callout type="info">
        The testnet mock uses realistic Iron Bank interest rates and LTV ratios so the strategy
        behaves like the mainnet version. On mainnet launch, no logic changes — only the contract
        addresses swap.
      </Callout>

      <H2>When to use Margin Loop</H2>
      <UL>
        <LI>You understand leverage and its liquidation risk</LI>
        <LI>You have set and reviewed stop-loss and drawdown-pause parameters</LI>
        <LI>Implied vol is at a moderate level — high spread income makes the borrow cost easier to outpace</LI>
        <LI>You want higher return potential than PLP Supplier and are willing to accept the downside</LI>
      </UL>
      <P>
        In calm-market conditions (low spread income), the borrow cost may exceed earnings and the
        strategy runs at a net loss. Use the Copilot to check current spread conditions before
        deploying, or check the leaderboard to see how Margin Loop creators are performing today.
      </P>
    </DocPage>
  )
}
