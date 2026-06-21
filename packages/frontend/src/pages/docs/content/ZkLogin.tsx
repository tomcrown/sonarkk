import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function ZkLogin() {
  return (
    <DocPage
      section={getSectionForSlug('zklogin')}
      title="zkLogin"
      tagline="Sign in with Google — no wallet extension or seed phrase required."
    >
      <H2>What is zkLogin?</H2>
      <P>
        zkLogin is a Mysten Labs protocol that derives a Sui address from an OAuth2 credential
        (Google, Apple, Facebook, etc.) using a zero-knowledge proof. The ZK proof mathematically
        binds the OAuth credential to a Sui address without revealing the underlying identity to
        validators. From the blockchain's perspective, a zkLogin transaction looks identical to any
        other Sui transaction — signed by a valid key.
      </P>
      <P>
        In Sonark, zkLogin is powered by <Strong>Mysten Labs Enoki</Strong> — a managed service
        that handles the ZK proof generation and key management so Sonark doesn't have to
        implement it from scratch.
      </P>

      <H2>How it works in Sonark</H2>
      <OL>
        <LI>User clicks <Strong>"Sign in with Google"</Strong></LI>
        <LI>Google OAuth flow completes → JWT returned to Sonark frontend</LI>
        <LI>Enoki generates a ZK proof that binds the JWT sub (Google user ID) to an ephemeral Sui signing key stored in the user's browser session</LI>
        <LI>A Sui address is derived deterministically from the Google credential + Enoki app key — the same address every time for the same Google account</LI>
        <LI>All subsequent Sui transactions (deploying strategies, creating PolicyCap, withdrawing) are signed by the ephemeral key, with the ZK proof attached</LI>
      </OL>
      <Callout type="info">
        The ephemeral signing key lives in the browser session. Closing the browser or clearing
        session storage ends the session. On next sign-in, the same Sui address is rederived
        from the Google credential — the address is permanent, the key is ephemeral.
      </Callout>

      <H2>What Sonark does and doesn't see</H2>
      <H3>Sonark sees</H3>
      <UL>
        <LI>Your Google email address (for display purposes)</LI>
        <LI>Your Sui address (derived from the credential)</LI>
      </UL>
      <H3>Sonark does not see</H3>
      <UL>
        <LI>Your private key — the ephemeral key never leaves the browser</LI>
        <LI>Your Google password or full OAuth token</LI>
        <LI>The ZK proof internals — these are generated client-side by Enoki</LI>
      </UL>

      <H2>Limitations and considerations</H2>
      <UL>
        <LI><Strong>Session-bound</Strong> — if you clear browser storage, you will need to sign in with Google again to reconstruct the ephemeral key. The address is the same; the session key is regenerated</LI>
        <LI><Strong>Google account dependency</Strong> — access to the Sui address is tied to access to the Google account. Losing access to Google = losing the ability to sign transactions from this address</LI>
        <LI><Strong>No seed phrase backup</Strong> — there is no seed phrase for a zkLogin address. Backup is not a user concern, but Google account security becomes critical</LI>
        <LI><Strong>Not cross-device by default</Strong> — sessions are browser-local; signing in on a second device starts a new session but uses the same address</LI>
      </UL>

      <H2>zkLogin vs. Sui wallet</H2>
      <P>
        Both sign-in methods result in the same on-chain experience — PolicyCap creation,
        portfolio deployment, withdrawals, and revocation all work identically. The difference
        is the signing mechanism:
      </P>
      <UL>
        <LI><Strong>Sui wallet</Strong> — user manages their own private key; compatible with any Sui dApp; key is the user's responsibility</LI>
        <LI><Strong>zkLogin via Enoki</Strong> — key is ephemeral and derived from OAuth; no extension required; key recovery depends on Google account access</LI>
      </UL>
      <P>
        For users deploying significant capital, a hardware wallet with a Sui wallet connection is
        recommended. zkLogin is ideal for users who prefer a Web2-familiar sign-in experience and
        are comfortable with the session-key model.
      </P>
    </DocPage>
  )
}
