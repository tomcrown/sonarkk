import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function ForCreators() {
  return (
    <DocPage
      section={getSectionForSlug('for-creators')}
      title="For Creators"
      tagline="Monetize your edge while keeping your strategy configuration private."
    >
      <H2>Public vs private strategies</H2>
      <P>
        Any deployed portfolio can be set to <Strong>public</Strong> (configuration visible,
        copyable by anyone for free) or <Strong>private</Strong> (configuration encrypted with Seal,
        accessible only via a paid CopyAccessTicket). Performance metrics are visible on the
        Leaderboard in both cases.
      </P>
      <P>
        Public strategies build a reputation — on-chain performance is verifiable by anyone.
        Private strategies let you monetize that reputation without revealing the configuration
        that produces it.
      </P>

      <H2>Setting a copy fee</H2>
      <P>
        When marking a strategy private, you set a <Strong>copy fee</Strong> in DUSDC. This is a
        one-time payment per copier — not a recurring subscription. When a copier purchases access,
        the fee transfers on-chain to your wallet. Sonark does not take a cut at the protocol level.
      </P>
      <H3>Fee considerations</H3>
      <UL>
        <LI>Higher fees act as a quality filter — serious copiers who've reviewed your on-chain track record</LI>
        <LI>Fee does not affect how many copies can exist — the strategy can be copied unlimited times</LI>
        <LI>You can change the fee at any time; existing CopyAccessTicket holders retain their access</LI>
        <LI>Fee is zero for public strategies (no CopyAccessTicket required)</LI>
      </UL>

      <H2>How your configuration stays private</H2>
      <P>
        When you deploy a private strategy, Sonark encrypts the configuration blob using
        <Strong> Seal</Strong>, Mysten Labs' threshold encryption protocol. The encrypted blob is
        then stored on <Strong>Walrus</Strong>, Sui's decentralized storage network. The blob is
        publicly readable — but only Seal's key servers can decrypt it, and they will only do so
        for wallets holding a valid on-chain <Strong>CopyAccessTicket</Strong>.
      </P>
      <P>
        The decryption key is not stored by Sonark. Sonark facilitates the access request but cannot
        access the configuration itself. Even if Sonark's servers were compromised, the configuration
        remains encrypted.
      </P>

      <H2>The CopyAccessTicket</H2>
      <P>
        A CopyAccessTicket is a Move object created on-chain when a copier pays the copy fee. It
        serves as the on-chain proof that access was purchased. When a copier initiates decryption,
        they present the ticket to Seal's key servers as authorization. The servers verify the ticket
        against the on-chain state and, if valid, release the decryption key to the copier's session.
      </P>
      <UL>
        <LI>One ticket per copier — non-transferable</LI>
        <LI>Ticket is permanent — copiers retain access indefinitely after purchase</LI>
        <LI>Creator can revoke individual tickets via a wallet transaction if needed</LI>
      </UL>

      <H2>Building a track record</H2>
      <P>
        Copiers make decisions based on on-chain performance. The most important factors are:
      </P>
      <UL>
        <LI><Strong>Cycle count</Strong> — how many expiry cycles the strategy has run (more = more signal)</LI>
        <LI><Strong>Drawdown history</Strong> — worst peak-to-trough NAV decline on-chain</LI>
        <LI><Strong>Vol regime coverage</Strong> — did the strategy run during both calm and volatile BTC periods?</LI>
        <LI><Strong>Consistency</Strong> — steady NAV curve vs. high variance</LI>
      </UL>
      <P>
        Running your strategy for multiple weeks before listing it as copyable gives copiers the
        track record they need to make a decision. A strategy with 5 cycles of history is much less
        convincing than one with 500.
      </P>
      <Callout type="info">
        Every result on your public performance page is on-chain and immutable. Positive results
        and negative results are equally visible. This is the trust model — performance cannot be
        cherry-picked or edited.
      </Callout>

      <H2>Changing visibility</H2>
      <P>
        You can switch a strategy from public to private (or vice versa) at any time:
      </P>
      <OL>
        <LI>Switching public → private encrypts the config with Seal and requires setting a copy fee</LI>
        <LI>Switching private → public decrypts and publishes the config; all prior CopyAccessTickets become unnecessary</LI>
        <LI>Switching to private does not affect existing copiers running the strategy — their vaults continue running independently</LI>
      </OL>
    </DocPage>
  )
}
