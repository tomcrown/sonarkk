import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { getSectionForSlug } from '../docsNav'

export default function SealWalrus() {
  return (
    <DocPage
      section={getSectionForSlug('seal-walrus')}
      title="Seal & Walrus"
      tagline="Encryption and decentralized storage infrastructure for private strategy configurations."
    >
      <H2>Overview</H2>
      <P>
        Private strategy configurations in Sonark require two things: a way to <Strong>encrypt</Strong>
        the config so only authorized parties can read it, and a way to <Strong>store</Strong> the
        encrypted blob permanently and accessibly. Seal handles encryption; Walrus handles storage.
        Together they make it possible to publish a strategy's performance on-chain while keeping
        its configuration private from everyone except approved copiers.
      </P>

      <H2>Seal — threshold encryption</H2>
      <P>
        Seal is Mysten Labs' threshold encryption service built on Sui. Its key property: the
        decryption key is split across a distributed network of key servers. No single server holds
        the full key. To decrypt, a threshold of servers must cooperate — and they only cooperate
        when an <Strong>on-chain access condition</Strong> is satisfied.
      </P>
      <H3>How threshold encryption works here</H3>
      <P>
        When a creator marks a strategy private, Sonark encrypts the config blob using an encryption
        key derived from Seal's threshold network. The access condition is encoded into the encryption:
        to decrypt, the requester must hold a valid <Strong>CopyAccessTicket</Strong> on-chain for
        this specific strategy.
      </P>
      <P>
        When a copier requests decryption, Seal's key servers check the Sui blockchain for the
        ticket. If it exists and is valid, the servers release their key shares to the copier's
        session. The copier's browser assembles the shares into the decryption key and decrypts
        the blob locally. The decryption key never leaves the copier's session; Sonark's servers
        never see the plaintext.
      </P>
      <H3>Security properties</H3>
      <UL>
        <LI>No single Seal key server can decrypt alone — requires a threshold (typically a majority) of servers</LI>
        <LI>Access is governed by on-chain state, not by Sonark's backend — Sonark cannot unilaterally grant or revoke access</LI>
        <LI>Compromising Sonark's servers does not expose encrypted configs — the ciphertext is public but unreadable without the Seal threshold</LI>
      </UL>

      <H2>Walrus — decentralized storage</H2>
      <P>
        Walrus is Sui's decentralized blob storage network. Data stored on Walrus is replicated
        across a set of storage nodes and addressable by a content hash (blob ID). Blobs are
        permanent — once written, they cannot be deleted or modified by any single party, including
        the uploader.
      </P>
      <H3>How Walrus is used in Sonark</H3>
      <UL>
        <LI>Encrypted strategy config blobs are uploaded to Walrus at private strategy deploy time</LI>
        <LI>The Walrus blob ID is recorded on-chain (in the portfolio's Move object)</LI>
        <LI>When a copier initiates access, Sonark fetches the blob from Walrus using the blob ID</LI>
        <LI>The keeper uses Walrus for daily audit snapshots — an immutable, tamper-proof record of NAV and cycle data</LI>
      </UL>
      <H3>Why Walrus instead of IPFS or centralized storage</H3>
      <UL>
        <LI>Persistence is economically guaranteed by Walrus storage epochs — blobs don't disappear when one node goes offline</LI>
        <LI>Native Sui integration — blob IDs can be referenced in Move objects directly</LI>
        <LI>No dependency on Sonark infrastructure — the blob is accessible regardless of whether Sonark's servers are running</LI>
      </UL>

      <H2>The full private strategy lifecycle</H2>
      <P>
        At deploy time (creator):
      </P>
      <UL>
        <LI>Config is encrypted with Seal (access condition: CopyAccessTicket for this strategy ID)</LI>
        <LI>Encrypted blob is uploaded to Walrus → blob ID returned</LI>
        <LI>Blob ID stored in the portfolio's on-chain Move object</LI>
        <LI>Plaintext config is discarded — never persisted by Sonark</LI>
      </UL>
      <P>
        At access time (copier):
      </P>
      <UL>
        <LI>Copier pays copy fee → receives CopyAccessTicket on-chain</LI>
        <LI>Copier requests decryption → Seal servers verify ticket on-chain</LI>
        <LI>Walrus blob fetched, decrypted locally in browser</LI>
        <LI>Decrypted config used to initialize copier's vault → never sent to Sonark servers</LI>
      </UL>
    </DocPage>
  )
}
