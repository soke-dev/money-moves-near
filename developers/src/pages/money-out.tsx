import { Link } from 'react-router-dom'
import { Accordion, C, H2, H3, Next, Note, P, Page, Step, Steps, Table, UL } from '@/components/docs'
import { DASHBOARD_URL } from '@/nav'

/* ─── Settlement ───────────────────────────────────────────────────── */

export function Settlement() {
  return (
    <Page title="Settlement" lead="Every payment settles instantly, on its own, the moment it's paid, to the place you chose. No batches, and no waiting for the end of the day.">
      <P>
        When a payment succeeds, we create a settlement and send the funds to your chosen destination. Each settlement contains the payment amount, minus our fee, and is linked to one payment. Track settlements in the dashboard or through the <Link to="/api/settlements">Settlements API</Link>.
      </P>

      <H2>Instant settlement</H2>
      <P>
        We don't hold payments for a scheduled batch payout. As soon as a payment is confirmed, its settlement is sent individually, with no daily cut-off or minimum balance. Bank and network processing times may affect when the funds arrive.
      </P>
      <P>We don't hold a balance for you to withdraw later. Once a payment is confirmed, settlement begins automatically.</P>

      <H2>Where money can go</H2>
      <Table
        head={['Place', 'Arrives as', 'What you need']}
        rows={[
          ['Your bank account', 'Local currency', 'Add an account in your business’s name under Settings → Payout places. We verify the account name first. You can add up to five accounts.'],
          ['A Money Moves account', 'USDC in the app', 'Link an account using its username. The account owner must approve the link in the app. You can link up to two accounts.'],
          ['Your business wallet', 'USDC on your chosen network', <>The owner can create a self-custody wallet after verification. Your business controls its keys. See <Link to="/business-wallet">Business wallet</Link>.</>],
        ]}
      />
      <P>
        Crypto payments settle as USDC, regardless of which coin and network the customer used. Choose a settlement network in settings: Solana, Movement, Stellar, Arc or Monad. You can change it at any time. If you settle to a bank account, funds are converted to local currency at the rate set for the payment.
      </P>

      <H2>Which place each payment uses</H2>
      <UL>
        <li>Choose a settlement destination for each payment link, invoice and store QR when you create it. Different links can use different accounts.</li>
        <li>
          An API checkout uses its <C>settle_to</C> value. If you omit it, funds go where you chose for API payments in the dashboard's Developer portal: a bank account, your Money Moves account or your business wallet. On Automatic, or while
          the place you chose can't take payments, they go to a verified bank account, then a linked Money Moves account, then your business wallet. Each settles the moment it's paid.
        </li>
        <li>A business signed up as an individual settles everything to its business wallet.</li>
      </UL>

      <H2>Following a settlement</H2>
      <P>
        A settlement remains <C>pending</C> while funds are on the way and becomes <C>completed</C> when they arrive. Your server then receives <C>settlement.completed</C>. Bank and network processing times determine how long delivery takes.
      </P>
      <P>
        A bank or blockchain may delay a settlement. It remains pending while our team investigates; it won't be marked as failed. If it remains pending longer than expected, contact support with the settlement reference.
      </P>

      <Accordion
        items={[
          [
            'Very small payments to a bank',
            <>Banks don't accept transfers under ₦100. A settlement below this amount can't be sent to a bank and requires assistance from our team. If a crypto checkout settles to a bank, set its price to at least ₦150.</>,
          ],
          [
            'Changing your bank account',
            <>Add the new account under Payout places and set it as the default. New payments use it; settlements already in progress continue to the original account.</>,
          ],
          [
            'Underpaid payments',
            <>An underpaid payment isn't settled. It's held until you decide: ask the customer for the rest, or refund what arrived.</>,
          ],
        ]}
      />
      <Next
        links={[
          ['/api/settlements', 'Settlements API', 'list and read settlements.'],
          ['/fees', 'Fees', 'what comes off each settlement.'],
          ['/business-wallet', 'Business wallet', 'where USDC settlements land.'],
        ]}
      />
    </Page>
  )
}

/* ─── Business wallet ──────────────────────────────────────────────── */

export function BusinessWallet() {
  return (
    <Page title="Business wallet" lead="A self-custody wallet for your business, holding USDC on the chains you settle to. You hold the keys, not us, and only the owner can move what's in it.">
      <P>
        The business wallet is a self-custody wallet linked to your business. Money Moves doesn't hold its keys. The owner signs in with the account email and approves each transfer with a transfer PIN. The owner can export the wallet to another wallet app at any time. You can receive USDC settlements and other transfers into it.
      </P>

      <H2>What self custody means</H2>
      <P>
        With a custodial account, the provider holds the funds and processes transfers for you. With a self-custody wallet, your business controls the keys. Money Moves can't spend from the wallet or move funds out of it. The owner must sign in and enter a transfer PIN to approve each transfer.
      </P>
      <UL>
        <li>Money Moves can't access the wallet's funds. Dashboard access alone isn't enough to approve a transfer; the owner must also sign in and enter the PIN.</li>
        <li>You can export the wallet and use it in another wallet app.</li>
        <li>Crypto payments settle to the wallet in USDC, subject to network confirmation.</li>
      </UL>
      <Note>With self-custody, your business is responsible for wallet access. Secure the account email, keep the transfer PIN private, and protect any exported keys as carefully as cash.</Note>

      <H2>Setting it up</H2>
      <Steps>
        <Step title="Get verified">
          <P>The wallet becomes available after your business is verified. Until then, the Wallet page shows what you need to complete.</P>
        </Step>
        <Step title="The owner creates it">
          <P>
            On the <a href={`${DASHBOARD_URL}/balances`}>Wallet</a> page, the owner signs in with the account email and creates the wallet. It includes addresses for Movement, Solana and EVM networks. Stellar can be enabled in an additional step.
          </P>
        </Step>
        <Step title="Set a transfer PIN">
          <P>Six digits, asked for on every send. Forgot it? The owner resets it by confirming their email.</P>
        </Step>
      </Steps>

      <H2>Sending from it</H2>
      <P>From the Wallet page, the owner enters an amount in local currency or USDC, then approves the transfer with the transfer PIN.</P>
      <Table
        head={['To', 'Fee', 'How long']}
        rows={[
          ['Your bank account, as local fiat', '₦100', 'Usually within minutes'],
          ['A linked Money Moves account', 'Free', 'As soon as the chain confirms'],
          ['Any crypto address', 'Free', 'As soon as the chain confirms'],
        ]}
      />
      <P>
        Transfers can't be initiated through the API because the owner must approve each one. Your server receives <C>payout.completed</C> or <C>payout.failed</C> for each transfer. You can check wallet holdings with <Link to="/api/balance">Balance</Link>.
      </P>

      <H3>Exporting the wallet</H3>
      <P>The owner can export the wallet keys for use in another wallet app. Before export, the owner must enter the transfer PIN and a code sent to their email.</P>
      <Note type="warn">Whoever holds the exported keys controls the money in the wallet. Keep them as safe as you'd keep cash.</Note>
    </Page>
  )
}

/* ─── Refunds ──────────────────────────────────────────────────────── */

export function Refunds() {
  return (
    <Page title="Refunds" lead="Money back to a customer, the way they paid. All of it or part of it, from the dashboard or the API.">
      <P>
        Payments are settled to you as soon as they're confirmed. To issue a refund, first send funds to the account provided for the refund; we then return the money to the customer using their original payment method. We return our fee on the refunded amount, so you send less than the customer receives.
      </P>

      <H2>How a refund goes</H2>
      <Steps>
        <Step title="Ask for it">
          <P>
            Start a refund from the payment in the dashboard or <Link to="/api/refunds#create">through the API</Link>. Enter the amount in the customer's payment currency: local currency for a bank transfer, or US dollars for the app and crypto. Omit the amount to refund the remaining balance.
          </P>
        </Step>
        <Step title="Fund it">
          <P>
            The refund includes a one-time account and the amount to transfer. Send the funds from your business bank account. We check for the transfer as it arrives and when you retrieve the refund. From the dashboard, you can also fund a refund from your business wallet or a linked Money Moves account. An underpaid payment that we haven't settled doesn't need additional funding; we refund the funds we're holding.
          </P>
        </Step>
        <Step title="We send it to the customer">
          <P>
            After your transfer arrives, we send the refund to the customer's bank account, Money Moves app or original crypto wallet, using the currency they paid with. Your server receives <C>refund.completed</C> when the refund is complete.
          </P>
        </Step>
      </Steps>

      <H2>Statuses</H2>
      <Table
        head={['Status', 'What it means', 'What to do']}
        rows={[
          [<C>awaiting_funds</C>, 'Waiting for your transfer to its account.', 'Send the amount it shows.'],
          [<C>processing</C>, 'Your money arrived. It’s on its way to the customer.', 'Nothing.'],
          [<C>completed</C>, 'The customer has their money.', 'Nothing.'],
          [<C>cancelled</C>, 'Called off before you funded it.', 'Ask for a new one if you still need it.'],
        ]}
      />

      <H2>Rules worth knowing</H2>
      <UL>
        <li>Refunds on one payment can't add up to more than what actually arrived.</li>
        <li>A payment can have one refund waiting for your money at a time. Fund it or cancel it before asking for another.</li>
        <li>Only the Owner, Admins and Finance on your team can ask for refunds in the dashboard.</li>
      </UL>
      <Next
        links={[
          ['/api/refunds', 'Refunds API', 'create, read, list, cancel and simulate refunds.'],
          ['/fees', 'Fees', 'how our fee comes back on a refund.'],
        ]}
      />
    </Page>
  )
}
