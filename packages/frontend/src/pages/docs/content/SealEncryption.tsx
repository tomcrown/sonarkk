import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { getSectionForSlug } from '../docsNav'

export default function SealEncryption() {
  return (
    <DocPage
      section={getSectionForSlug('seal-encryption')}
      title="Seal Encryption"
      tagline="Threshold encryption that keeps strategy configurations private while stored on-chain."
    >
      <H2>What is Seal?</H2>
      <P>
        Seal is Mysten Labs' threshold encryption protocol on Sui. It uses a distributed network of
        key servers — no single server holds the full decryption key. To decrypt, a threshold of
        servers must cooperate, and they will only do so when an on-chain access condition is
        satisfied. This means access to encrypted data is governed by on-chain state, not by
        Sonark's backend.
      </P>
      <P>
        In Sonark's case, the access condition is possession of a valid <Strong>CopyAccessTicket</Strong>:
        a Move object minted on-chain when a copier pays the creator's copy fee.
      </P>

      <H2>How Sonark encrypts strategy configs</H2>
      <OL>
        <LI>Creator deploys a private strategy — the full configuration object (strategy type, parameters, thresholds) is serialized to JSON</LI>
        <LI>Sonark calls Seal's encryption API with the config blob and the access policy (must hold a CopyAccessTicket for this strategy ID)</LI>
        <LI>Seal encrypts the blob using a key derived from the threshold network — no single party holds the key</LI>
        <LI>The encrypted ciphertext is stored on <Strong>Walrus</Strong> (Sui's decentralized storage) — the blob ID is recorded on-chain</LI>
        <LI>The original plaintext is discarded — Sonark never stores the decrypted config after encryption</LI>
      </OL>

      <H2>How a copier accesses the config</H2>
      <OL>
        <LI>Copier purchases access → wallet receives a <Strong>CopyAccessTicket</Strong> object on-chain</LI>
        <LI>Copier initiates strategy copy in the Sonark UI</LI>
        <LI>Sonark's frontend requests the encrypted blob from Walrus using the stored blob ID</LI>
        <LI>Frontend sends a decryption request to Seal's key servers, presenting the CopyAccessTicket as proof</LI>
        <LI>Seal's key servers verify the ticket on-chain — if it belongs to a valid CopyAccessTicket for this strategy, they release their key shares</LI>
        <LI>Frontend assembles the key shares and decrypts the blob locally in the browser</LI>
        <LI>Decrypted config is used to initialize the copier's vault — it is never sent to Sonark's servers</LI>
      </OL>
      <CodeBlock label="ACCESS FLOW">
{`copier wallet
  └─ holds CopyAccessTicket (on-chain proof of payment)
      └─ presents to Seal key servers
          └─ servers verify ticket on-chain
              └─ if valid: release key shares
                  └─ frontend assembles key → decrypts blob
                      └─ config used locally, never sent to Sonark`}
      </CodeBlock>

      <H2>What's public and what's private</H2>
      <H3>Always visible on the Leaderboard</H3>
      <UL>
        <LI>Strategy type (PLP Supplier, Range Roll, etc.)</LI>
        <LI>Protocol tags</LI>
        <LI>Full NAV performance history (cycle by cycle, on-chain)</LI>
        <LI>Drawdown metrics</LI>
        <LI>Number of copiers</LI>
        <LI>Creator address</LI>
      </UL>
      <H3>Hidden for private strategies (accessible only with CopyAccessTicket)</H3>
      <UL>
        <LI>Utilization target</LI>
        <LI>Strike selection logic</LI>
        <LI>Vol target (for Vol-Targeted Range)</LI>
        <LI>Hedge multiplier (for Hedged PLP)</LI>
        <LI>Any custom configuration parameters</LI>
      </UL>

      <H2>Sonark's role</H2>
      <P>
        Sonark facilitates the access request (calls Seal's API, manages blob IDs) but cannot access
        the decrypted content. The decryption happens in the copier's browser session. Sonark's
        servers never see the plaintext configuration of private strategies — not when the creator
        deploys, not when a copier accesses.
      </P>
    </DocPage>
  )
}
