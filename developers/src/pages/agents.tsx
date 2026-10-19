import { Link } from 'react-router-dom'
import { Accordion, Block, C, H2, H3, Next, Note, P, Page, Step, Steps, Table, UL } from '@/components/docs'

/* ─── AI agents ────────────────────────────────────────────────────── */

export function Agents() {
  return (
    <Page
      title="PayBox"
      lead="Use the Money Moves plugin for PayBox inside ChatGPT and Claude: pay any Money Moves business from the chat, or run your own business's checkout. The assistant does the work; you approve every payment yourself."
    >
      <H2>How it works</H2>
      <P>
        <a href="https://paybox.sh">PayBox</a> is a wallet built for AI assistants. You connect your assistant to your PayBox account, and the assistant can then use plugins: small sets of tools that let it do things for you. The Money Moves plugin gives it
        the tools to pay any Money Moves business and, for a business, to take payments.
      </P>
      <P>The important part is who can move money. Your assistant can look things up and prepare a payment, but it can't send one:</P>
      <UL>
        <li>The assistant proposes the exact transfer: who gets paid, how much, from which wallet.</li>
        <li>PayBox shows you that proposal in its own window, outside the chat.</li>
        <li>Only when you approve it there does PayBox sign and send it.</li>
      </UL>
      <P>The assistant never holds your wallet's keys, and nothing in the chat can approve a payment for you.</P>

      <H2>Use it in ChatGPT and Claude</H2>
      <P>Connect PayBox to the assistant you already use, and the Money Moves plugin is there in your chats. Any assistant that supports MCP (the Model Context Protocol, the open standard assistants use for tools) works too:</P>
      <Table
        head={['Assistant', 'Where to connect PayBox']}
        rows={[
          ['Claude', <>On claude.ai or the Claude desktop app, add PayBox under Settings, Connectors. In Claude Code, add it as an MCP server.</>],
          ['ChatGPT', <>Add PayBox under Settings, Apps and Connectors. Custom connectors need developer mode turned on.</>],
          ['Cursor, Windsurf and other coding tools', <>Add PayBox as an MCP server in the tool's MCP settings.</>],
          ['Your own agent', <>Connect to PayBox from any MCP client, like the Claude Agent SDK or the OpenAI Agents SDK.</>],
        ]}
      />
      <P>PayBox gives you the address to connect with in your PayBox account. Once it's connected, the assistant finds the Money Moves plugin by itself; you don't have to tell it tool names.</P>

      <H2 id="customers">Pay a business with your assistant</H2>
      <P>For anyone paying a Money Moves business: a payment link, an invoice or a store QR.</P>
      <Steps>
        <Step title="Set up PayBox">
          <P>Create a PayBox account and add a Solana wallet holding USDC. Payments through the plugin are made in USDC on Solana.</P>
        </Step>
        <Step title="Turn on the Money Moves plugin">
          <P>In PayBox, find Money Moves in the plugin list and enable it.</P>
        </Step>
        <Step title="Connect your assistant">
          <P>Connect Claude, ChatGPT or another assistant to your PayBox account, as above.</P>
        </Step>
        <Step title="Ask it to pay">
          <P>Give it the link, invoice or store address, and say what you want. For example:</P>
          <Block lang="text" label="Example" code={`Pay this invoice for me: https://pay.usemoneymoves.xyz/i/ada-fashion-0042\nSend the receipt to ada@example.com`} />
          <P>The assistant looks it up first and tells you who you're paying, what for, and the price in local fiat and in dollars, before anything is opened.</P>
        </Step>
        <Step title="Approve it in PayBox">
          <P>
            When you say go ahead, the assistant opens the payment and proposes the exact USDC transfer to that payment's own address. PayBox shows it to you. Check the business, the amount and the wallet, then approve. Nothing moves until you do.
          </P>
        </Step>
        <Step title="Done">
          <P>The assistant follows the payment until it lands, then gives you the transaction and the receipt link. The receipt is also emailed to you.</P>
        </Step>
      </Steps>
      <P>For a link without a set price, tell the assistant how much to pay, in local fiat or dollars. The business is paid in full: if it has the customer pay the processing fee, the price the assistant shows you already includes it.</P>

      <H2 id="businesses">Run your business's checkout with your assistant</H2>
      <P>For a business: your assistant can make checkouts for customers, tell you when they're paid, and show your latest payments and your balance.</P>
      <Steps>
        <Step title="Make an API key">
          <P>
            In your dashboard, go to <a href="https://business.usemoneymoves.xyz/settings/api-keys">Developer portal, API keys</a> and make a key for your assistant. Start with a test key: checkouts it makes are test ones, and nothing real moves.
          </P>
        </Step>
        <Step title="Add the key to the plugin in PayBox">
          <P>
            In PayBox, open the Money Moves plugin's settings and add the key as a secret for the host <C>business.usemoneymoves.xyz</C>, with the header <C>Authorization</C> and the value <C>Bearer sk_test_…</C>.
          </P>
          <P>PayBox adds the key to each request itself. It never appears in the plugin, the chat or anything the assistant can read.</P>
        </Step>
        <Step title="Ask it">
          <Block
            lang="text"
            label="Examples"
            code={`Make a checkout for ₦45,000 for the Ankara gown, order 1042, for ada@example.com. Close it in 24 hours.\n\nHas order 1042 been paid?\n\nShow me today's payments.\n\nHow much is on its way to my bank, and what's in my business wallet?`}
          />
          <P>A checkout takes every way to pay you have switched on: bank transfer, the Money Moves app and crypto. The assistant gives you its link to send the customer.</P>
        </Step>
        <Step title="Go live">
          <P>When it all works, replace the test key with a live key in the same place. Your assistant then makes real checkouts.</P>
        </Step>
      </Steps>
      <Note type="warn" title="Treat the key like a password">
        Anyone with your live key can make checkouts and read your payments, so add it only in PayBox's secret settings, never in a chat. A key can't send money out of your business: payouts and the business wallet stay in your dashboard, and the plugin has no refund tool.
        Revoke a key you no longer use in Developer portal, API keys.
      </Note>

      <H2>The tools in the plugin</H2>
      <H3>For paying a business</H3>
      <Table
        head={['Tool', 'What it does', 'What it needs']}
        rows={[
          [<C>money_moves_options</C>, 'The ways Money Moves businesses can be paid right now, the crypto fee and the payment limits.', 'Nothing'],
          [<C>quote_business_payment</C>, 'Looks up a link, invoice or store QR: which business, what for, the price in local fiat and dollars, and whether it takes USDC on Solana. Nothing is opened or paid.', <C>link</C>],
          [
            <C>pay_business_with_solana_usdc</C>,
            'Opens the payment and proposes the exact USDC transfer on Solana, for you to approve in PayBox.',
            <>
              <C>link</C>, your wallet's <C>sender</C> address, <C>email</C> for the receipt; <C>name</C>, <C>phone</C>, and <C>amount</C> with <C>currency</C> when the link has no set price
            </>,
          ],
          [<C>payment_status</C>, 'Whether the payment is open, paid, underpaid or expired, with the transaction and the receipt link once it lands.', <C>payment</C>],
        ]}
      />
      <H3>For your business</H3>
      <Table
        head={['Tool', 'What it does', 'What it needs']}
        rows={[
          [<C>create_checkout</C>, 'Makes a checkout for one amount and returns its link.', <><C>amount</C>, <C>currency</C>; optional <C>description</C>, <C>reference</C>, customer email and name, and <C>expires_in_minutes</C></>],
          [<C>get_checkout</C>, 'Whether a checkout is open, paid, expired or cancelled, with its payment once paid.', <C>id</C>],
          [<C>list_payments</C>, 'Your latest payments from checkouts, links, invoices and store QRs, newest first.', <>Optional <C>status</C> and <C>limit</C></>],
          [<C>get_balance</C>, "Money on its way to where it settles, what your business wallet holds on each network, and today's rate.", 'Nothing'],
        ]}
      />
      <P>The business tools use the <Link to="/api">Money Moves API</Link> with your key, so they follow the same rules: a test key sees test mode, a live key sees live mode.</P>

      <H2>What the business sees</H2>
      <P>
        Nothing new to set up. A payment from an assistant is an ordinary crypto payment: it shows in Payments, sends the same <Link to="/webhooks/events">webhooks</Link>, carries the usual crypto fee, and settles the way the business chose,
        to its bank account, its Money Moves account or its business wallet.
      </P>

      <H2>Common questions</H2>
      <Accordion
        items={[
          ['Can the assistant pay without asking me?', <>No. It can only propose a transfer. Every payment opens in PayBox for you to approve, and nothing moves until you do.</>],
          ['Which coins and networks work?', <>USDC on Solana. To pay with something else, open the payment link yourself: the checkout takes bank transfers, the Money Moves app and more coins and networks.</>],
          ['What does it cost me?', <>Money Moves charges the payer nothing extra unless the business has customers pay the processing fee, in which case it's already in the price the assistant shows you. You may need a little SOL in your wallet for Solana's network fee, which is a fraction of a cent.</>],
          ['The payment says open, not paid', <>Ask the assistant to check the payment's status again. A transfer usually lands within seconds of your approval. If the payment expired before you approved, ask for a new one: an expired payment can't be paid.</>],
          ['I approved the wrong amount', <>The assistant always pays a payment's exact price, so this only happens with a link that has no set price. Contact the business: it can refund you from its dashboard, back to the wallet you paid from.</>],
          ['Is my business key safe in PayBox?', <>PayBox keeps it as a secret for <C>business.usemoneymoves.xyz</C> only and adds it to requests itself. The assistant and the plugin never see it. You can revoke it from your dashboard at any time.</>],
        ]}
      />

      <Next
        links={[
          ['/checkout', 'Checkout', 'what customers see when they open a checkout your assistant made'],
          ['/api/checkouts', 'Checkouts API', 'the API behind create_checkout and get_checkout'],
          ['/test-mode', 'Test mode', 'try everything without real money'],
        ]}
      />
    </Page>
  )
}
