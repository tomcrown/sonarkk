import { DocPage, H2, H3, P, UL, LI, Strong } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { getSectionForSlug } from '../docsNav'

export default function VaultShareTokens() {
  return (
    <DocPage
      section={getSectionForSlug('vault-share-tokens')}
      title="Vault & Share Tokens"
      tagline="How deposits, NAV accounting, and withdrawal mechanics work."
    >
      <H2>The vault</H2>
      <P>
        Each Sonark portfolio is backed by a <Strong>Vault</Strong> — a Move smart contract that holds
        pooled DUSDC, maintains a <Strong>PredictManager</Strong> for open positions, and tracks the
        strategy configuration. The vault is the accounting unit: all deposits go in, all payouts come
        back in, and the keeper only acts within the vault's defined scope.
      </P>
      <P>
        Users interact with the vault primarily through two actions: <Strong>deposit</Strong> (receive
        share tokens) and <Strong>withdraw</Strong> (burn share tokens, receive DUSDC). The keeper
        interacts with the vault through keeper-only entry functions gated by the PolicyCap.
      </P>

      <H2>Depositing</H2>
      <P>
        To deposit, a user transfers DUSDC to the vault. The vault mints share tokens proportional
        to the current NAV per share:
      </P>
      <CodeBlock label="SHARE MINTING">
{`shares_minted = deposit_amount / nav_per_share

# On first deposit:
nav_per_share  = 1.0 DUSDC
shares_minted  = deposit_amount`}
      </CodeBlock>
      <P>
        The user receives <Strong>Coin&lt;VAULT_SHARE&gt;</Strong> tokens in their wallet. Each vault
        has its own Coin type defined by a TreasuryCap at deploy time — shares from different vaults
        are not interchangeable.
      </P>

      <H2>NAV (Net Asset Value)</H2>
      <P>
        NAV represents the total value of the vault's assets divided by the number of shares
        outstanding. It is updated after each keeper cycle:
      </P>
      <CodeBlock label="NAV CALCULATION">
{`total_assets = liquid_dusdc
             + mark_to_market(open_plp_positions)
             + mark_to_market(open_predict_positions)
             + mark_to_market(open_spot_hedge)

nav_per_share = total_assets / total_shares`}
      </CodeBlock>
      <P>
        Mark-to-market values are read from on-chain Predict state at settlement time. Between
        settlements, NAV is an estimate; the post-settlement NAV is the definitive value.
      </P>
      <H3>What affects NAV</H3>
      <UL>
        <LI>Settled payouts from Predict positions (wins increase NAV, losses decrease it)</LI>
        <LI>PLP LP income from the spread on each bet placed in the pool</LI>
        <LI>Hedge PnL on DeepBook Spot (for Hedged PLP strategy)</LI>
        <LI>The spread cost paid on each deployment (for bettor strategies)</LI>
      </UL>
      <Callout type="info">
        NAV per share can only be definitively updated after a Predict position settles, because
        the payoff of an open binary/range position depends on the final oracle price. The Dashboard
        shows a live estimate between settlements and the confirmed value after each settlement.
      </Callout>

      <H2>Share tokens</H2>
      <P>
        Share tokens are standard Sui <Strong>Coin</Strong> objects. They are fully composable with
        the Sui DeFi ecosystem:
      </P>
      <UL>
        <LI>Transferable — send to any Sui address</LI>
        <LI>Usable as collateral in margin or lending protocols (where integrations exist)</LI>
        <LI>Readable NAV — on-chain NAV makes pricing deterministic for any consumer</LI>
        <LI>Each vault has a unique Coin type — one TreasuryCap per vault at deploy time</LI>
      </UL>
      <P>
        Share tokens represent ownership of the vault's net assets at the current NAV per share.
        They are not liquid market tokens — there is no AMM pool for them. Value is redeemable
        exclusively by burning through the vault's withdraw function.
      </P>

      <H2>Withdrawing</H2>
      <P>
        To withdraw, a user burns share tokens. The vault calculates the DUSDC equivalent at the
        current NAV per share and transfers it out:
      </P>
      <CodeBlock label="WITHDRAWAL">
{`dusdc_returned = shares_burned × nav_per_share
# subject to: available_balance >= dusdc_returned`}
      </CodeBlock>
      <P>
        Withdrawal is immediate as long as the <Strong>liquidity reserve</Strong> is intact. The
        reserve is the minimum DUSDC fraction the keeper is configured to never deploy — it is
        always available for withdrawals. A user withdrawing more than the liquid balance would need
        to wait for the current deployed position to settle.
      </P>
      <Callout type="info">
        The vault has a <Strong>token-bucket withdrawal limiter</Strong> inherited from the Predict
        protocol — large withdrawals over a short window are rate-limited to prevent liquidity drain
        attacks on the PLP. Normal-sized withdrawals are unaffected.
      </Callout>

      <H2>Keeper-independent exit</H2>
      <P>
        The vault's withdrawal path does not go through the keeper. If the keeper is down, paused,
        or the PolicyCap has expired:
      </P>
      <UL>
        <LI>Call <Strong>redeem_permissionless</Strong> directly on any settled Predict position to claim its payout</LI>
        <LI>Call the vault's withdraw function to burn share tokens and receive DUSDC</LI>
      </UL>
      <P>
        The keeper is never a gatekeeper for fund recovery. Users retain direct access to their
        assets at all times.
      </P>

      <H2>Multiple depositors</H2>
      <P>
        Each portfolio is currently single-user (one depositor per vault). The share token
        architecture is designed to support pooled multi-depositor vaults in the future — NAV
        accounting is already built for it.
      </P>
    </DocPage>
  )
}
