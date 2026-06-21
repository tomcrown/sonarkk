import { DocPage, H2, H3, P, UL, OL, LI, Strong, Table, THead, TBody, TR, TH, TD } from '../DocPage'
import { CodeBlock } from '../components/CodeBlock'
import { getSectionForSlug } from '../docsNav'

export default function TheKeeper() {
  return (
    <DocPage
      section={getSectionForSlug('the-keeper')}
      title="The Keeper"
      tagline="The automated process that executes your strategy every expiry cycle."
    >
      <H2>What the keeper is</H2>
      <P>
        The keeper is a TypeScript process running with its own dedicated private key — separate from
        any user wallet. It has no UI and no human clicking buttons. It is a loop that wakes up on
        every oracle event, reads on-chain state, decides what to do based on the strategy and the
        PolicyCap, and submits a Sui Programmable Transaction Block (PTB). That is the automation.
      </P>
      <P>
        The keeper's key can never move funds to an arbitrary address. It can only call the specific
        entry functions permitted by the on-chain PolicyCap object on each portfolio. Even if the
        keeper key were compromised, the damage is bounded by the budget ceiling set in the cap.
      </P>

      <H2>The core loop</H2>
      <P>
        Every time a new oracle activates on DeepBook Predict (roughly every 15–60 minutes on testnet),
        the keeper runs a full cycle for every active portfolio. One oracle activation = one cycle per
        portfolio.
      </P>
      <CodeBlock label="KEEPER LOOP">
{`for each active oracle:
  for each portfolio subscribed to this expiry:
    1. settle()    — redeem prior position if expired
    2. read()      — oracle state, SVI vol, vault NAV
    3. deploy()    — strategy-specific PTB
    4. record()    — write result to DB`}
      </CodeBlock>
      <P>
        The loop is idempotent: if the keeper crashes mid-cycle and restarts, it detects that the
        cycle was already processed (via the portfolio + expiry key in the DB) and skips it. No
        double execution.
      </P>

      <H2>Stage 1: Settle</H2>
      <P>
        If a prior position exists for this portfolio and the oracle has settled, the keeper calls
        <Strong> predict::redeem_permissionless</Strong> to claim the payout. This function is
        permissionless — anyone can call it on behalf of a position owner. The payout (win or loss)
        is credited back to the portfolio's DUSDC balance automatically, with no user action needed.
      </P>
      <P>
        For PLP positions, the keeper calls the withdrawal function to convert PLP LP tokens back to
        liquid DUSDC before re-deploying in the next step.
      </P>

      <H2>Stage 2: Read state</H2>
      <P>
        The keeper reads three things from the chain and the predict-server oracle feed:
      </P>
      <UL>
        <LI><Strong>Oracle params</Strong> — current BTC forward price and the SVI parameters (σ, ρ, ν, etc.) calibrated by the Mysten Labs SVI feeder</LI>
        <LI><Strong>Vol floor check</Strong> — is the current ATM implied vol above this strategy's minimum threshold? If not, the keeper skips deployment and logs the reason</LI>
        <LI><Strong>Vault NAV</Strong> — current liquid DUSDC + mark-to-market value of any open positions, used to compute the deployment size</LI>
      </UL>

      <H2>Stage 3: Deploy</H2>
      <P>
        Based on the strategy type, the keeper constructs and submits a single atomic PTB. Each
        strategy maps to a specific set of Predict and DeepBook contract calls:
      </P>
      <Table>
        <THead>
          <TR>
            <TH>Strategy</TH>
            <TH>On-chain calls</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>PLP Supplier</TD>
            <TD>predict::supply → store LP token in vault</TD>
          </TR>
          <TR>
            <TD>Hedged PLP</TD>
            <TD>predict::supply + DeepBook Spot limit/market order to offset net pool delta</TD>
          </TR>
          <TR>
            <TD>Smart Vault</TD>
            <TD>allocate across PLP Supplier and Hedged PLP per vol regime weighting</TD>
          </TR>
          <TR>
            <TD>Principal Protected</TD>
            <TD>iron_bank::deposit (principal) + predict::mint on accumulated yield only</TD>
          </TR>
          <TR>
            <TD>Margin Loop</TD>
            <TD>iron_bank → deepbook_margin borrow → predict::supply or mint_range</TD>
          </TR>
          <TR>
            <TD>Range Roll</TD>
            <TD>predict::mint_range around ATM strike</TD>
          </TR>
          <TR>
            <TD>Vol-Targeted Range</TD>
            <TD>predict::mint_range with position size scaled to vol target</TD>
          </TR>
        </TBody>
      </Table>
      <P>
        Deployment size is calculated as:
      </P>
      <CodeBlock label="SIZING">
{`available_balance = vault_balance - liquidity_reserve
deploy_amount     = available_balance × utilization_target`}
      </CodeBlock>
      <P>
        This ensures the liquidity reserve is never touched and only a controlled fraction of the
        free balance is at risk each cycle.
      </P>

      <H2>Stage 4: Record</H2>
      <P>
        After the PTB confirms, the keeper writes the full cycle result to the database: NAV after
        settlement, what was deployed, payout from settlement, deploy amount, skip reason if
        applicable, and the Sui transaction digest. This data powers the Dashboard and Leaderboard.
      </P>

      <H2>The slice-per-cycle design</H2>
      <P>
        The keeper deploys a <Strong>fraction</Strong> of the vault balance each cycle, not the full
        balance. This is intentional and has three benefits:
      </P>
      <UL>
        <LI><Strong>Liquidity</Strong> — the rest of the balance stays as liquid DUSDC, available for immediate withdrawal at any time without waiting for an expiry to settle</LI>
        <LI><Strong>Risk spreading</Strong> — each sub-hour expiry is a separate market; deploying a slice per cycle spreads exposure across multiple sequential expiries rather than concentrating it in one</LI>
        <LI><Strong>Budget cap alignment</Strong> — the PolicyCap limits total DUSDC moved by the keeper, so deploying per-cycle keeps the cap from exhausting too quickly</LI>
      </UL>

      <H2>Vol floor checks</H2>
      <P>
        The keeper enforces a per-strategy minimum ATM vol threshold before deploying. If the live
        oracle's implied vol is below the floor, the keeper skips deployment entirely (but still
        settles prior positions). This prevents house strategies from deploying into degenerate
        low-vol oracles where spread income is negligible, and prevents bettor strategies from
        entering at unfavorable short-vol entry points.
      </P>
      <Table>
        <THead>
          <TR>
            <TH>Strategy</TH>
            <TH>Min ATM vol</TH>
            <TH>Reason</TH>
          </TR>
        </THead>
        <TBody>
          <TR><TD>PLP Supplier</TD><TD>15%</TD><TD>Spread income exists at any reasonable vol</TD></TR>
          <TR><TD>Hedged PLP</TD><TD>18%</TD><TD>Delta hedge unreliable at very low vol</TD></TR>
          <TR><TD>Smart Vault</TD><TD>18%</TD><TD>Includes hedge leg</TD></TR>
          <TR><TD>Principal Protected</TD><TD>15%</TD><TD>Yield-based, vol-independent</TD></TR>
          <TR><TD>Range Roll</TD><TD>28%</TD><TD>Low implied vol = unfavorable short-vol entry</TD></TR>
          <TR><TD>Vol-Targeted Range</TD><TD>28%</TD><TD>Same — vol-targeting doesn't fix bad entry</TD></TR>
        </TBody>
      </Table>
      <P>
        The keeper also checks spread health as a secondary signal: if the computed spread at the ATM
        strike is within 0.1% of the spread floor (a sign of miscalibrated SVI), the cycle is skipped
        regardless of vol level.
      </P>

      <H2>Keeper-independent exit</H2>
      <P>
        Users can always withdraw even if the keeper is down. The vault's withdrawal path does not
        depend on the keeper — it is a direct contract function that burns share tokens and returns
        DUSDC. If any position is open and unsettled, the user can call <Strong>redeem_permissionless</Strong> directly
        to claim it before withdrawing. The keeper never stands between a user and their funds.
      </P>

      <H2>Automatic stop conditions</H2>
      <P>
        The keeper monitors portfolio health each cycle and pauses or deactivates automatically:
      </P>
      <UL>
        <LI><Strong>Drawdown pause</Strong> — if NAV drops X% from its peak, keeper stops opening new positions (still settles existing ones)</LI>
        <LI><Strong>Stop loss</Strong> — if NAV falls below an absolute floor, keeper permanently deactivates the portfolio</LI>
        <LI><Strong>Budget exhausted</Strong> — when the PolicyCap's budget ceiling is reached, keeper stops deploying until the user refreshes the cap</LI>
        <LI><Strong>Cap expired</Strong> — PolicyCap expires after 30 days; keeper pauses until user calls refresh_policy</LI>
      </UL>
      <P>
        All stop conditions are visible on the Dashboard. None of them affect the user's ability to
        withdraw — funds remain accessible in all states.
      </P>

      <H2>Crash safety</H2>
      <P>
        Every cycle is keyed by portfolio ID and expiry ID before any on-chain action is taken. If
        the keeper crashes between settlement and deployment, on restart it reads the DB, finds the
        partially-processed cycle, and skips to the correct stage. If it crashes during PTB submission,
        the idempotency check prevents re-submission: the keeper checks whether the portfolio already
        has an open position for this expiry before submitting a new one.
      </P>
    </DocPage>
  )
}
