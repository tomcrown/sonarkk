import { DocPage, H2, P, Strong } from '../DocPage'
import { getSectionForSlug } from '../docsNav'

interface TermProps {
  term: string
  children: React.ReactNode
}

function Term({ term, children }: TermProps) {
  return (
    <div className="border-b border-border/50 py-5 grid grid-cols-[200px_1fr] gap-6 items-start">
      <dt className="text-sm font-semibold text-foreground font-mono pt-0.5 shrink-0">{term}</dt>
      <dd className="text-[14px] text-muted-foreground leading-relaxed">{children}</dd>
    </div>
  )
}

export default function Glossary() {
  return (
    <DocPage
      section={getSectionForSlug('glossary')}
      title="Glossary"
      tagline="Key terms used throughout the Sonark documentation."
    >
      <H2>Protocol</H2>
      <dl>
        <Term term="DeepBook Predict">
          The vol-surface-priced prediction protocol on Sui that Sonark strategies run on. Prices
          every binary and range outcome against a calibrated SVI volatility surface. Live on Sui
          testnet; mainnet launch planned.
        </Term>
        <Term term="DeepBook Spot">
          The on-chain central limit order book (CLOB) for BTC/USDC on Sui. Used by Sonark's
          Hedged PLP strategy to place delta-hedge orders. Live on both testnet and mainnet.
        </Term>
        <Term term="PLP (Prediction Liquidity Pool)">
          The vault inside DeepBook Predict that takes the other side of every binary and range bet.
          LP suppliers deposit DUSDC and earn the spread on every bet placed. House strategies
          supply to the PLP.
        </Term>
        <Term term="PredictManager">
          A Move object owned by a Sonark vault that holds all open Predict positions (binary, range,
          and PLP LP tokens) for that vault. One PredictManager per portfolio.
        </Term>
        <Term term="SVI">
          Stochastic Volatility Inspired — a parametric volatility surface model used by DeepBook
          Predict to price every strike and expiry. Calibrated each oracle cycle by the Mysten Labs
          SVI feeder. The same model is used in professional derivatives markets.
        </Term>
        <Term term="ATM vol">
          At-the-money implied volatility — the SVI-implied vol at the strike closest to the current
          BTC forward price. Used by Sonark for vol floor checks and vol-targeted position sizing.
        </Term>
        <Term term="dUSDC">
          The quote asset on DeepBook Predict testnet. Not official USDC — a testnet-only asset
          minted for testing. All Sonark strategy deposits are denominated in dUSDC.
        </Term>
        <Term term="Iron Bank">
          A permissioned money market / lending protocol on Sui mainnet. Used by Principal Protected
          (to hold principal) and Margin Loop (to borrow against collateral). Mocked with real logic
          on testnet.
        </Term>
        <Term term="deepbook_margin">
          The margin trading and liquidation module of DeepBook on Sui mainnet. Used by Margin Loop
          to execute borrow-and-deploy operations. Mainnet only.
        </Term>
        <Term term="PTB">
          Programmable Transaction Block — a Sui primitive that bundles multiple contract calls into
          a single atomic transaction. The keeper submits one PTB per portfolio per cycle.
        </Term>
        <Term term="Oracle">
          The on-chain price feed that publishes the settlement price and SVI parameters for each
          DeepBook Predict expiry. Published by the Mysten Labs oracle service.
        </Term>
      </dl>

      <H2>Sonark concepts</H2>
      <dl>
        <Term term="Keeper">
          A TypeScript process with its own dedicated key that runs strategy execution every expiry
          cycle. Settles prior positions, computes deployment size, and submits one PTB per portfolio.
          Runs autonomously after the initial deploy transaction.
        </Term>
        <Term term="PolicyCap">
          A Move capability object on-chain that defines the keeper's authority: which portfolio it
          can act on, the budget ceiling (max DUSDC it can move), scope (Predict-only), and expiry
          (30 days). Created by the user's wallet and transferred to the keeper at deploy time.
        </Term>
        <Term term="Vault">
          The Move smart contract that holds a portfolio's DUSDC, maintains the PredictManager,
          mints and burns share tokens, and provides the keeper-gated entry functions the keeper
          calls each cycle.
        </Term>
        <Term term="Share Token">
          A standard Sui Coin minted by the vault on deposit. Represents proportional ownership
          of the vault's net assets at the current NAV per share. One Coin type per vault (TreasuryCap).
        </Term>
        <Term term="NAV (Net Asset Value)">
          Total value of the vault's assets (liquid DUSDC + mark-to-market open positions) divided
          by total shares outstanding. Updated after each keeper cycle. NAV per share determines
          the exchange rate for deposits and withdrawals.
        </Term>
        <Term term="NAV per share">
          The DUSDC value of one share token at the current NAV. On first deposit, 1.0. Rises as
          the vault earns (PLP spread, settled payouts). Falls as the vault loses (Predict payouts
          to bettors, spread cost).
        </Term>
        <Term term="Utilization target">
          The fraction of free vault balance deployed per keeper cycle. Controls how much capital
          is at risk in each expiry and how quickly the full balance is deployed across cycles.
        </Term>
        <Term term="Liquidity reserve">
          The minimum vault balance fraction the keeper never deploys. Always available for
          immediate withdrawal. Set by the user at deploy time.
        </Term>
        <Term term="Drawdown pause">
          A user-configured drawdown threshold (% from peak NAV). When breached, the keeper stops
          opening new positions but continues settling existing ones. Lifts automatically on NAV
          recovery.
        </Term>
        <Term term="Stop loss">
          A user-configured absolute NAV floor. When NAV falls below it, the keeper permanently
          deactivates the portfolio. Requires a manual wallet transaction to re-enable.
        </Term>
        <Term term="Hedge multiplier">
          Scales the DeepBook Spot hedge size relative to the measured PLP net delta. 1.0× = full
          hedge. Used by Hedged PLP and Smart Vault strategies.
        </Term>
        <Term term="Vol target">
          The reference ATM vol that Vol-Targeted Range sizes to. Position size scales down when
          live implied vol exceeds the target, reducing exposure in high-vol environments.
        </Term>
      </dl>

      <H2>Copy trading</H2>
      <dl>
        <Term term="CopyAccessTicket">
          A Move object minted on-chain when a copier pays a creator's copy fee. Serves as the
          on-chain proof of authorized access. Presented to Seal's key servers to unlock decryption
          of private strategy configurations.
        </Term>
        <Term term="Seal">
          Mysten Labs' threshold encryption protocol on Sui. Used to encrypt private strategy
          configurations so only wallets holding a valid CopyAccessTicket can decrypt them.
        </Term>
        <Term term="Walrus">
          Sui's decentralized blob storage network. Encrypted strategy configs and daily audit
          snapshots are stored on Walrus. Blobs are permanent and content-addressable by blob ID.
        </Term>
        <Term term="zkLogin">
          A Sui protocol that derives a Sui address from an OAuth2 credential using a zero-knowledge
          proof. Allows users to sign in with Google without a wallet extension or seed phrase.
          Powered by Mysten Labs Enoki in Sonark.
        </Term>
      </dl>

      <H2>Market mechanics</H2>
      <dl>
        <Term term="Spread">
          The cost charged to bettors by the PLP vault on each prediction. Computed as
          base_spread × √(p(1−p)), floored at 0.5%, scaled by a utilization multiplier up to ×2.
          This is the house strategies' primary income source.
        </Term>
        <Term term="ATM (At the money)">
          A strike or range positioned at or very close to the current BTC forward price.
        </Term>
        <Term term="OTM (Out of the money)">
          A strike or range positioned away from the current BTC forward price. OTM range positions
          have a lower win probability but a wider spread for higher potential payout.
        </Term>
        <Term term="Short vol">
          A position that profits when realized volatility is low (BTC stays in a range). Bettor
          strategies are short-vol: they win when BTC is quiet and lose when BTC moves sharply.
        </Term>
        <Term term="Delta">
          The sensitivity of a position's value to a $1 change in BTC price. The PLP vault
          accumulates net delta from open bets; the Hedged PLP strategy offsets this delta with a
          DeepBook Spot trade each cycle.
        </Term>
        <Term term="Expiry">
          The end of a Predict market cycle. At expiry, the oracle publishes the final BTC price
          and all open positions for that expiry settle — paying out or expiring worthless.
        </Term>
        <Term term="Settlement">
          The process of resolving an expired Predict position. The oracle price determines the
          outcome; payouts are claimable immediately via redeem or redeem_permissionless.
        </Term>
      </dl>
    </DocPage>
  )
}
