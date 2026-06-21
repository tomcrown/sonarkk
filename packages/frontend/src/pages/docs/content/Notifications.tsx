import { DocPage, H2, H3, P, UL, OL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { getSectionForSlug } from '../docsNav'

export default function Notifications() {
  return (
    <DocPage
      section={getSectionForSlug('notifications')}
      title="Notifications"
      tagline="Real-time Telegram alerts for every keeper action on your portfolios."
    >
      <H2>Overview</H2>
      <P>
        Sonark's keeper runs autonomously — it executes supply cycles, places delta hedges, settles
        positions, and handles errors without any manual input. Telegram notifications give you a
        real-time feed of everything the keeper does across all your portfolios, delivered directly
        to your phone.
      </P>
      <P>
        Notifications are optional and per-wallet. You choose which event types to receive. All
        alerts include a direct link to the Sui transaction on Suivision so you can verify every
        on-chain action instantly.
      </P>

      <H2>Linking your wallet</H2>
      <OL>
        <LI>Open <Strong>Settings → Notifications</Strong> in the Sonark app</LI>
        <LI>Click <Strong>Generate Link Code</Strong> — a short alphanumeric code is shown (valid for 10 minutes)</LI>
        <LI>Open Telegram and start a chat with the Sonark bot: <Strong>@SonarkBot</Strong></LI>
        <LI>Send the code as a message — the bot replies confirming your wallet is linked</LI>
        <LI>Your Telegram account is now paired with your Sui wallet address</LI>
      </OL>
      <P>
        The link is one wallet per Telegram account. If you have multiple wallets, link each
        separately by connecting that wallet and generating a new code.
      </P>

      <H2>Notification types</H2>
      <H3>Supply cycle executed</H3>
      <P>
        Sent when the keeper successfully completes a PLP supply, range mint, or principal-protected
        yield cycle. Includes the oracle ID, any detail about position size or yield captured, and
        the Sui transaction link.
      </P>
      <H3>Delta hedge placed</H3>
      <P>
        Sent when the Hedged PLP or Smart Vault keeper executes a DeepBook Spot hedge order to
        offset directional exposure. Includes the hedge coverage ratio (what percentage of net delta
        was hedged).
      </P>
      <H3>Cycle skipped</H3>
      <P>
        Sent when the keeper skips an expiry — for example because implied vol is below the
        strategy's minimum threshold, or because the oracle hasn't settled yet. Includes the skip
        reason.
      </P>
      <H3>Keeper error</H3>
      <P>
        Sent when the keeper encounters an unexpected error on your portfolio — a failed transaction,
        an RPC timeout, or an on-chain assertion failure. These are the highest-priority alerts: a
        persistent error may mean the keeper has paused on your portfolio.
      </P>
      <H3>NAV milestone</H3>
      <P>
        Sent when your portfolio's NAV per share crosses a meaningful threshold — typically a +5%
        or −5% move from the previous snapshot. Useful for tracking performance without watching
        the dashboard continuously.
      </P>
      <H3>Policy cap event</H3>
      <P>
        Sent when the keeper's spending authority approaches or hits its on-chain budget cap
        (PolicyCap). This is a signal that the keeper may need its policy refreshed before it can
        continue executing cycles.
      </P>

      <H2>Notification preferences</H2>
      <P>
        Each type can be toggled independently from the Notifications settings page. The defaults
        on link are:
      </P>
      <UL>
        <LI><Strong>Supply cycle</Strong> — off by default (can be noisy for active strategies)</LI>
        <LI><Strong>Delta hedge</Strong> — off by default</LI>
        <LI><Strong>Cycle skipped</Strong> — off by default</LI>
        <LI><Strong>Keeper error</Strong> — on by default (always recommended)</LI>
        <LI><Strong>NAV milestone</Strong> — on by default</LI>
        <LI><Strong>Policy cap</Strong> — on by default</LI>
      </UL>

      <H2>Example alert</H2>
      <CodeBlock label="TELEGRAM MESSAGE">
{`✅ Supply cycle executed
Portfolio: cmqo1adr…
Oracle: 0x3fa1c8d2…
Supplied 4,999 DUSDC at 2.1% spread
View tx: testnet.suivision.xyz/txblock/Hx3k…
Sun, 21 Jun 2026 19:42:05 UTC`}
      </CodeBlock>

      <H2>Unlinking</H2>
      <P>
        To unlink your Telegram account, go to <Strong>Settings → Notifications</Strong> and click
        <Strong>Unlink</Strong>. You will receive a final confirmation message in Telegram and
        notifications will stop immediately. You can re-link at any time using a new code.
      </P>

      <H2>Privacy</H2>
      <P>
        Sonark stores your Telegram chat ID (a numeric identifier Telegram assigns to each
        conversation) paired with your wallet address. No other Telegram account data is stored.
        The bot cannot read your Telegram messages — it only sends outgoing notifications. Unlinking
        removes the chat ID from Sonark's database permanently.
      </P>
    </DocPage>
  )
}
