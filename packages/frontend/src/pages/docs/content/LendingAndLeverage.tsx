import { DocPage, H2, H3, P, UL, LI, Strong, Table, THead, TBody, TR, TH, TD } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function LendingAndLeverage() {
  return (
    <DocPage
      section={getSectionForSlug('lending-and-leverage')}
      title="Lending & Leverage"
      tagline="How Iron Bank and deepbook_margin extend Sonark strategies beyond simple Predict deployment."
    >
      <H2>Why lending protocols matter to Sonark</H2>
      <P>
        Most Sonark strategies interact with a single protocol — DeepBook Predict. Two strategies
        go further: <Strong>Principal Protected</Strong> and <Strong>Margin Loop</Strong> both
        integrate a lending layer. The lending layer changes the risk profile of each strategy
        fundamentally — in opposite directions.
      </P>
      <UL>
        <LI>
          <Strong>Principal Protected</Strong> uses lending to <em>reduce</em> risk: principal sits
          in a money market and never touches Predict. Only the accumulated yield is at risk.
        </LI>
        <LI>
          <Strong>Margin Loop</Strong> uses lending to <em>amplify</em> exposure: the deposit is
          collateral for a borrow, and the combined capital is deployed to Predict for leveraged
          spread income.
        </LI>
      </UL>
      <P>
        Understanding the two lending protocols Sonark uses — <Strong>Iron Bank</Strong> and
        <Strong> deepbook_margin</Strong> — is important context for both strategies.
      </P>

      <H2>Iron Bank</H2>
      <P>
        Iron Bank is a permissioned money market protocol on Sui mainnet. It is the lending
        primitive shared by both Principal Protected and Margin Loop. Users (or in this case,
        the Sonark keeper) deposit an asset as collateral; Iron Bank holds it and makes it
        available as liquidity, paying a deposit rate in return.
      </P>
      <H3>How Sonark uses Iron Bank</H3>
      <UL>
        <LI>
          <Strong>Principal Protected</Strong> — the full DUSDC deposit is placed in Iron Bank as
          the <em>principal holding vehicle</em>. Iron Bank pays a base lending rate on it. The
          keeper reads the accrued yield each cycle and harvests it for deployment to Predict.
          The principal itself is never removed from Iron Bank for Predict exposure.
        </LI>
        <LI>
          <Strong>Margin Loop</Strong> — the DUSDC deposit is placed in Iron Bank as
          <em> collateral</em>. Iron Bank issues a credit line based on that collateral. The keeper
          then draws from the credit line (borrows DUSDC) via deepbook_margin and deploys the
          borrowed capital to Predict.
        </LI>
      </UL>
      <H3>Rates and collateral ratios</H3>
      <P>
        Iron Bank's deposit rate (for Principal Protected) and its collateral factor (the maximum
        borrow-to-collateral ratio, for Margin Loop) are protocol parameters set by Iron Bank
        governance. Sonark reads these rates on-chain each cycle to compute yield harvests and
        LTV safety margins accurately.
      </P>

      <H2>deepbook_margin</H2>
      <P>
        deepbook_margin is the margin and liquidation module of the DeepBook ecosystem on Sui
        mainnet. It sits between Iron Bank's credit line and the actual use of borrowed funds.
        While Iron Bank handles collateral and credit issuance, deepbook_margin handles the
        mechanics of drawing from that credit, executing borrows, and managing liquidation.
      </P>
      <H3>How Sonark uses deepbook_margin</H3>
      <P>
        Only the Margin Loop strategy uses deepbook_margin directly. After Iron Bank issues a
        credit line against the user's collateral, the keeper calls deepbook_margin to execute
        the borrow — receiving DUSDC that is then deployed to Predict. The keeper also uses
        deepbook_margin to monitor LTV ratio, reduce borrow size if needed, and repay from
        Predict settlements.
      </P>
      <Callout type="info">
        Principal Protected does not use deepbook_margin at all — it only interacts with Iron Bank
        for the lending deposit and yield harvest. No borrowing occurs in Principal Protected.
      </Callout>

      <H2>Protocol summary by strategy</H2>
      <Table>
        <THead>
          <TR>
            <TH>Strategy</TH>
            <TH>Iron Bank role</TH>
            <TH>deepbook_margin role</TH>
            <TH>Predict role</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Principal Protected</TD>
            <TD>Holds principal, pays deposit yield</TD>
            <TD>Not used</TD>
            <TD>Receives harvested yield only</TD>
          </TR>
          <TR>
            <TD>Margin Loop</TD>
            <TD>Holds collateral, issues credit line</TD>
            <TD>Executes borrow, manages LTV</TD>
            <TD>Receives collateral + borrowed capital</TD>
          </TR>
        </TBody>
      </Table>

      <H2>Capital flow comparison</H2>
      <CodeBlock label="PRINCIPAL PROTECTED">
{`User deposit (DUSDC)
  → Iron Bank deposit  →  earns base lending yield
  → keeper harvests yield each cycle
  → yield → predict::supply or predict::mint
  → Predict payout cycles back to vault
  → principal stays in Iron Bank throughout`}
      </CodeBlock>
      <CodeBlock label="MARGIN LOOP">
{`User deposit (DUSDC)
  → Iron Bank collateral  →  credit line issued
  → deepbook_margin borrow  →  borrowed DUSDC
  → deposit + borrow → predict::supply / mint_range
  → Predict settlement  →  borrow repaid  →  net P&L
  → LTV monitored each cycle; deleverage if needed`}
      </CodeBlock>

      <H2>Testnet mocking</H2>
      <P>
        Both Iron Bank and deepbook_margin are <Strong>mainnet-only protocols</Strong>. They do not
        exist on Sui testnet. For testnet operation, Sonark ships a lending mock that faithfully
        replicates both protocols' interfaces and economics:
      </P>
      <UL>
        <LI>The mock accepts DUSDC deposits and tracks balances per vault</LI>
        <LI>It accrues a realistic interest rate on deposits (Principal Protected yield) and borrows (Margin Loop borrow cost)</LI>
        <LI>It enforces collateral ratios and credit line limits identically to how mainnet Iron Bank would</LI>
        <LI>The keeper code uses the same function signatures for both mock and mainnet — switching is a contract address change only</LI>
      </UL>
      <P>
        The mock does not contact any external service — it is a self-contained TypeScript
        implementation that runs alongside the keeper. All economic logic (yield accrual, LTV
        calculation, liquidation thresholds) is real; only the underlying protocol is simulated.
      </P>

      <H2>Mainnet implications</H2>
      <P>
        On mainnet launch, Principal Protected and Margin Loop will interact with live Iron Bank
        and deepbook_margin contracts. The key practical differences from testnet:
      </P>
      <UL>
        <LI>Real interest rates set by protocol governance — not a fixed mock rate</LI>
        <LI>Real liquidity conditions — borrow availability depends on Iron Bank's utilization</LI>
        <LI>Real liquidation risk — positions can be liquidated by external keepers if LTV thresholds are breached and Sonark's keeper does not deleverage in time</LI>
        <LI>Principal Protected principal has real yield but also Iron Bank counterparty risk</LI>
      </UL>
      <Callout type="warning">
        For Margin Loop specifically: liquidation on mainnet is permanent. The Sonark keeper
        monitors LTV actively, but extreme intraday BTC moves can outpace the keeper's ability
        to deleverage. Treat stop-loss configuration as mandatory, not optional, for this strategy.
      </Callout>
    </DocPage>
  )
}
