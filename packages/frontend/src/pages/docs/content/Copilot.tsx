import { DocPage, H2, H3, P, UL, OL, LI, Strong, Table, THead, TBody, TR, TH, TD } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function Copilot() {
  return (
    <DocPage
      section={getSectionForSlug('copilot')}
      title="Sonark Copilot"
      tagline="An AI assistant that knows your portfolio, the market, and every strategy — and can configure a deployment for you in one click."
    >
      <H2>What the Copilot is</H2>
      <P>
        The Copilot is a conversational AI built into the Sonark app. It is not a generic chatbot —
        it has live read access to your portfolio state, the current BTC implied volatility surface,
        active oracle data, and the public leaderboard. When you ask it a question, it answers in
        the context of what is actually happening on-chain right now.
      </P>
      <P>
        You do not need to understand every parameter to deploy a strategy. Describe what you want
        in plain language — the Copilot reasons about your goal, current market conditions, and
        the available strategies, then proposes a fully configured deployment you can launch
        directly from the conversation.
      </P>

      <H2>Two modes</H2>
      <H3>Without a connected wallet</H3>
      <P>
        The Copilot answers general questions about Sonark, the strategies, DeepBook Predict, the
        SVI surface, and how the keeper works. Useful for learning before you commit capital.
      </P>
      <H3>With a connected wallet</H3>
      <P>
        When your wallet is connected, the Copilot also sees your live portfolio data: which
        strategies are running, current NAV per share, drawdown from peak, active positions, and
        your configured risk parameters. Advice is personalised to your actual situation rather
        than a hypothetical.
      </P>
      <Callout type="info">
        Connect your wallet before opening the Copilot for the best experience. The context it
        has access to — your portfolio, live oracle data, leaderboard — makes its recommendations
        meaningfully more specific.
      </Callout>

      <H2>What it knows</H2>
      <Table>
        <THead>
          <TR>
            <TH>Data source</TH>
            <TH>What the Copilot can see</TH>
          </TR>
        </THead>
        <TBody>
          <TR><TD>Your portfolio</TD><TD>Strategy type, NAV, drawdown, risk params, open positions</TD></TR>
          <TR><TD>BTC vol surface</TD><TD>Live ATM implied vol, SVI parameters from current oracle</TD></TR>
          <TR><TD>DeepBook Predict</TD><TD>Active oracle data, spread estimates at current utilization</TD></TR>
          <TR><TD>Leaderboard</TD><TD>Top-performing public strategies and their configurations</TD></TR>
          <TR><TD>Strategy catalog</TD><TD>All 8 strategies, their mechanics, risk profiles, and protocol dependencies</TD></TR>
        </TBody>
      </Table>

      <H2>Strategy recommendations and prefill</H2>
      <P>
        This is the Copilot's most powerful feature. When you ask for a recommendation — or when
        the Copilot determines one is appropriate — it outputs a strategy card directly in the
        chat. The card shows:
      </P>
      <UL>
        <LI>The recommended strategy and its class (house / bettor / leveraged)</LI>
        <LI>Reasoning: why this strategy fits your stated goal and current conditions</LI>
        <LI>Proposed configuration: utilization target, liquidity reserve, drawdown pause, and any strategy-specific parameters (hedge multiplier, vol target, strike selection)</LI>
      </UL>
      <P>
        Clicking <Strong>"Configure and deploy this strategy"</Strong> on the card takes you
        directly to the Strategy Explorer with every field pre-filled. You review the configuration,
        adjust anything you want, and deploy — no manual parameter entry.
      </P>
      <CodeBlock label="PREFILL FLOW">
{`1. Copilot outputs sonark-action block in chat response
2. Block renders as a DeployActionCard in the UI
3. User clicks "Configure and deploy this strategy"
4. Parameters written to session storage (sonark_prefill)
5. App navigates to /explore
6. VaultConfigModal opens pre-filled with all parameters
7. User reviews → deploys`}
      </CodeBlock>

      <H2>What to ask</H2>
      <P>
        The Copilot handles a wide range of questions. Some examples:
      </P>
      <H3>Market and conditions</H3>
      <UL>
        <LI>"What is the current BTC implied vol?"</LI>
        <LI>"Is the spread wide enough to make PLP supply attractive right now?"</LI>
        <LI>"What vol regime are we in — calm, normal, or high?"</LI>
      </UL>
      <H3>Strategy selection (lazy path)</H3>
      <UL>
        <LI>"I want to make money but not lose a lot — what should I run?"</LI>
        <LI>"Set me up with the safest strategy available."</LI>
        <LI>"Which strategy on the leaderboard should I copy?"</LI>
        <LI>"I have 500 DUSDC. What would you deploy and how?"</LI>
      </UL>
      <H3>Portfolio-specific (wallet connected)</H3>
      <UL>
        <LI>"How is my PLP Supplier strategy performing?"</LI>
        <LI>"Am I close to my drawdown pause threshold?"</LI>
        <LI>"Should I increase my utilization target given current vol?"</LI>
        <LI>"Explain how my strategy has been earning over the last 10 cycles."</LI>
      </UL>
      <H3>Education</H3>
      <UL>
        <LI>"What is the spread formula for ATM strikes?"</LI>
        <LI>"Explain how the PolicyCap limits what the keeper can do."</LI>
        <LI>"What is the difference between Hedged PLP and Smart Vault?"</LI>
        <LI>"What happens to my funds if the keeper goes offline?"</LI>
      </UL>

      <H2>What the Copilot cannot do</H2>
      <UL>
        <LI><Strong>It cannot execute transactions</Strong> — it can configure and navigate to the deploy modal, but you sign every transaction from your own wallet</LI>
        <LI><Strong>It cannot modify your running strategy</Strong> — configuration changes require your wallet signature</LI>
        <LI><Strong>It cannot access funds</Strong> — the Copilot is read-only; it never touches the keeper key or your PolicyCap</LI>
        <LI><Strong>It cannot predict price</Strong> — it can tell you current implied vol and spread conditions, not where BTC is going</LI>
        <LI><Strong>Conversation history is session-local</Strong> — the current session clears on page refresh; history persistence is coming</LI>
      </UL>

      <H2>Streaming responses</H2>
      <P>
        The Copilot uses a server-sent events (SSE) stream so responses appear word-by-word
        rather than all at once. If the API server is unreachable, you will see an inline error.
        Responses can be aborted at any time by starting a new conversation with the <Strong>New</Strong> button.
      </P>
    </DocPage>
  )
}
