import { isValidElement, useEffect, type ReactElement, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Logo } from '@/components/brand'

/**
 * The business side's legal pages: the terms of service (which are also the
 * merchant agreement), the privacy policy, and what businesses can't use
 * Money Moves for. Public - linked from sign-up, onboarding, the checkout and
 * every page footer. Written to be read: plain words, one column.
 *
 * No provider is named here. Each is described by what it does for us.
 */

const UPDATED = '18 October 2026'
const COMPANY = 'Movers Digital Technologies Ltd'
const SUPPORT = 'support@usemoneymoves.xyz'

/** A paragraph (plain, or with a link in it), or a bulleted list. */
type Block = string | ReactElement | { list: ReactNode[] }
type Section = { id: string; title: string; body: Block[] }

function Page({ title, intro, sections }: { title: string; intro: ReactNode; sections: Section[] }) {
  useEffect(() => {
    document.title = `${title} · Money Moves Business`
    window.scrollTo(0, 0)
  }, [title])
  return (
    <div className="funnel flex min-h-full flex-col bg-cream text-ink-green">
      <header className="flex h-16 items-center justify-between gap-4 px-5 sm:px-10">
        <Link to="/" className="shrink-0">
          <Logo color="#0F2419" />
        </Link>
        <Link to="/login" className="text-[13.5px] text-ink-green/70 underline-offset-4 hover:underline">
          Log in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 pb-16 pt-6 sm:px-10">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 border-b border-[#E6E1D4] pb-3 text-[14px]">
          {[
            ['/legal/terms', 'Terms of service'],
            ['/legal/privacy', 'Privacy policy'],
            ['/legal/prohibited', 'Prohibited businesses'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? 'font-semibold text-ink-green' : 'text-ink-green/60 hover:text-ink-green')}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <h1 className="display mt-10 text-[40px] font-bold leading-[1.05] tracking-[-0.02em] sm:text-[48px]">{title}</h1>
        <p className="mt-3 text-[14px] text-ink-green/60">Last updated {UPDATED}</p>
        <div className="mt-6 text-[16px] leading-[1.7] text-ink-green/85">{intro}</div>

        {sections.length > 4 && (
          <ol className="mt-8 columns-1 gap-8 text-[14.5px] leading-[1.9] sm:columns-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-ink-green/75 underline-offset-4 hover:text-ink-green hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        )}

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-6 pt-10">
            <h2 className="display text-[22px] font-bold tracking-[-0.01em]">
              {i + 1}. {s.title}
            </h2>
            {s.body.map((b, j) =>
              typeof b === 'string' || isValidElement(b) ? (
                <p key={j} className="mt-3 text-[15.5px] leading-[1.75] text-ink-green/85">
                  {b}
                </p>
              ) : (
                <ul key={j} className="mt-3 list-disc space-y-1.5 pl-5 text-[15.5px] leading-[1.7] text-ink-green/85 marker:text-ink-green/40">
                  {b.list.map((item, k) => (
                    <li key={k}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}

        <p className="mt-14 border-t border-[#E6E1D4] pt-6 text-[14.5px] leading-[1.7] text-ink-green/70">
          Questions about this page? Email <a href={`mailto:${SUPPORT}`} className="font-medium text-ink-green underline underline-offset-4">{SUPPORT}</a>, or message us from the help chat in your dashboard.
        </p>
      </main>

      <footer className="display flex flex-wrap justify-between gap-3 px-5 py-6 text-[14px] font-bold tracking-[-0.01em] text-ink-green sm:px-10">
        <span>© {COMPANY}</span>
        <span className="flex gap-5">
          <Link to="/legal/privacy" className="underline-offset-4 hover:underline">Privacy</Link>
          <Link to="/legal/terms" className="underline-offset-4 hover:underline">Terms</Link>
          <a href={`mailto:${SUPPORT}`} className="underline-offset-4 hover:underline">Help</a>
        </span>
      </footer>
    </div>
  )
}

const prohibitedLink = (
  <Link to="/legal/prohibited" className="font-medium text-ink-green underline underline-offset-4">
    Prohibited businesses
  </Link>
)
const privacyLink = (
  <Link to="/legal/privacy" className="font-medium text-ink-green underline underline-offset-4">
    Privacy policy
  </Link>
)

// ─── Terms of service ─────────────────────────────────────────────────────

const TERMS: Section[] = [
  {
    id: 'key',
    title: 'Key things to know',
    body: [
      'Please read these terms in full. In short:',
      {
        list: [
          'Money Moves provides payment technology. We are not a bank, we are not part of any sale between you and your customers, and we do not guarantee your goods, your services or your customers.',
          'You are responsible for your business: what you sell, delivering it, your customers, your refunds and disputes, your licences and your taxes.',
          'A payment counts only once the money has arrived and we have confirmed it. On-chain payments are final, nobody can reverse them or recover funds sent to the wrong address or network.',
          'We may hold, delay or refuse a settlement, keep a reserve, or recover money you owe us from what we would otherwise pay you, where these terms allow it.',
          'Your business wallet is self-custodial: we cannot move, freeze, recover or reverse what is in it.',
          'Our liability to you is limited, and you cover us for losses your business causes.',
        ],
      },
    ],
  },
  {
    id: 'agreement',
    title: 'This agreement',
    body: [
      `These terms are an agreement between ${COMPANY} ("Money Moves", "we", "us") and the business you register ("you"). They cover Money Moves Business: the dashboard, the checkout your customers use, payment links, invoices, store QR codes, the business wallet, the API, and everything else we provide to businesses. They are also our merchant agreement.`,
      'By creating an account, ticking a box to accept, or using Money Moves Business, you accept these terms, our Privacy policy and the list of Prohibited businesses. If you are accepting for a company, you confirm that you are authorised to bind it, and both you and the company are bound.',
    ],
  },
  {
    id: 'role',
    title: 'What we are, and what we are not',
    body: [
      'Money Moves provides software and payment technology that lets you accept payments and receive the money. Money moves through licensed banks, payment partners and public blockchain networks, which we do not control.',
      {
        list: [
          'We are not a bank and do not offer banking services. Money we receive for you is held only for as long as it takes to settle it, or as these terms allow, and does not earn interest for you.',
          'We are not the seller of your goods or services, and not your agent, partner, employee or guarantor. Any sale is between you and your customer alone.',
          'We do not check, endorse or stand behind what you sell, its quality, its delivery, or anything you say about it.',
          'We do not give financial, legal, tax or investment advice.',
          'We owe you no fiduciary duty: we are not your trustee, adviser or representative.',
        ],
      },
    ],
  },
  {
    id: 'eligibility',
    title: 'Who can use Money Moves Business',
    body: [
      'You can use Money Moves Business as a registered company or as an individual working for yourself. You must be at least 18, able to enter a binding contract, and not barred from receiving financial services under any law that applies to you.',
      'You may not use the service if you, your business, or anyone who owns or controls it is the subject of sanctions, or if you are located in, or organised under the laws of, a sanctioned country or territory. You may not hide where you are, for example with a VPN, to use the service.',
    ],
  },
  {
    id: 'accounts',
    title: 'Your account and your team',
    body: [
      'You must give us accurate, complete and current information, use a real email address you control (not a temporary or disposable one), and keep everything up to date. Tell us within 14 days if anything material about your business changes, such as its owners, directors, address or what it sells. One login can belong to several businesses, and each business can add team members with roles that limit what they can do.',
      'You are responsible for everything done through your account, by you or by anyone you add to it or let use it. Keep your password, the sign-in codes we send you, your transfer PIN and your API keys private. Tell us at once at ' + SUPPORT + ' if you think your account has been used without your permission. We are not liable for losses caused by your login details, PIN or keys being used by someone else.',
    ],
  },
  {
    id: 'verification',
    title: 'Verification',
    body: [
      'Before you can take live payments, we verify your business. This includes checking the identity of the person who represents it and reviewing the business details and documents you give us. We may ask for more at any time, such as a BVN, further documents or answers to questions, and these appear as tasks in your Compliance page. You must answer them truthfully and on time.',
      'We may refuse to verify a business, limit what it can do, or withdraw verification, at our discretion and where the law requires. We do not have to tell you why. We never simulate identity checks or document reviews.',
    ],
  },
  {
    id: 'details',
    title: 'Changing your business details',
    body: [
      'Your business name, phone number and support contacts are what your customers see, and we check them when you activate. Once you are live, you can ask to change them from Settings. A change waits for our approval and does not take effect until we approve it. We may ask for evidence, such as registration documents for a new name, and may decline a change.',
    ],
  },
  {
    id: 'test-mode',
    title: 'Test mode',
    body: [
      'Every business starts in test mode. Test payments, settlements, refunds and API calls run on a simulator and never move real money. Nothing done in test mode creates an obligation for either of us, and test data may be cleared at any time.',
    ],
  },
  {
    id: 'payments',
    title: 'Taking payments',
    body: [
      'Once verified, you can accept payments through payment links, invoices, store QR codes, your own checkout built with our API, and any other way we offer. Depending on what you switch on, your customers can pay by bank transfer, in the Money Moves app, or in stablecoins.',
      {
        list: [
          'A bank transfer is made to an account opened for that one payment, for the exact amount, and is open for a limited time.',
          'A stablecoin payment is made to the address shown for that payment, for the exact amount, on the network shown. A payment on any other network, in any other coin, or for a different amount may be lost, and we are not responsible for it.',
          'A payment made in the Money Moves app is approved by your customer in the app and counts once we have confirmed it on chain.',
          'A payment is complete only when the money has actually arrived and we have confirmed it. A screenshot, a receipt from another app or a message from a customer is not proof of payment, and you rely on one at your own risk.',
          'A payment that is short, late or otherwise does not match is held, not settled. It can be refunded to the customer or completed by agreement.',
          'Where an amount is shown in more than one currency, the rate is the one shown at checkout when the payment is started. Rates move, and we are not responsible for changes in value after that.',
          'A second payment for an invoice that is already paid goes back to the customer. It is not settled to you.',
          'We may set limits on how much one payment, or all your payments over a period, can be, and change them at any time.',
        ],
      },
      'You must only take payments for genuine goods and services that you provide yourself, describe them honestly, and not split, disguise or take payments for anyone else.',
    ],
  },
  {
    id: 'responsibilities',
    title: 'Your responsibilities',
    body: [
      {
        list: [
          'Running a lawful business, and holding every licence, permit and registration it needs.',
          'Delivering what your customers pay for, as described, and dealing with their questions, complaints, returns and refunds.',
          'Following the laws that protect your customers, including consumer protection, advertising and data protection law.',
          'Keeping the personal data you collect about your customers safe, and using it only as the law allows.',
          'Keeping your own records of your sales, and proof that you delivered what was paid for, for at least 12 months after each sale.',
          'Answering our questions and sending us what we ask for within 72 hours, or sooner where a bank, partner or the law needs it sooner.',
          'Showing your customers your terms, your refund policy and how to contact you before they pay.',
          'Paying all taxes that apply to your business and your sales, including VAT, and filing your own returns. We do not collect or pay tax for you, fees we charge may themselves be subject to tax, and we may report payment information to tax authorities where the law requires.',
        ],
      },
    ],
  },
  {
    id: 'settlement',
    title: 'Settlement',
    body: [
      'You choose where your money goes: a bank account in your business name (or, if you work for yourself, your own name), a Money Moves username linked with its owner’s approval, or your business wallet. A Money Moves username and your business wallet are both self-custodial. We settle each payment once it is confirmed, less our fee. Stablecoin and app payments settle as the stablecoin and on the network we tell you.',
      'We may delay, hold, review or refuse a settlement where we reasonably need to, including to confirm a payment, to check for fraud, a dispute or other risk, to meet a legal or regulatory obligation, if your account is restricted, or if a bank, partner or network fails or delays. Settlement times are estimates, not promises.',
      'If we settle more than we should have, in error, because a payment is reversed or recalled, or for any other reason, you must repay the difference straight away, and we may take it from future settlements.',
      'A settlement sent to the bank account, Money Moves username or wallet address you gave us is final once it is sent, even if those details turn out to be wrong, so check them carefully. Money we cannot settle because your details are wrong or no longer work waits until you give us details that do.',
    ],
  },
  {
    id: 'reserves',
    title: 'Holds, reserves and what you owe us',
    body: [
      'Where we reasonably believe there is a higher risk of refunds, reversals, disputes, fraud, fines or other losses connected with your business, we may keep back part of your settlements as a reserve, for as long as that risk lasts. We will tell you when we set one up, unless the law or a risk to others prevents it.',
      'Anything you owe us, fees, refunds we have funded, reversed or recalled payments, fines or charges a bank, partner or regulator makes because of your business, and costs of recovery. We may take from any settlement or reserve due to you. If that is not enough, you must pay us the rest when we ask, and we may recover it by other lawful means. We may take what you owe from your settlements without telling you first, and a debt you owe us continues after your account closes.',
      'If your refunds, disputes or customer complaints are unusually high, we may hold settlements, set up or raise a reserve, lower your limits or close your account.',
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    body: [
      'Our fees are shown in your dashboard. Unless your dashboard shows a different rate agreed for your business, they are currently:',
      {
        list: [
          'Bank transfer payments: 0.5% of the amount, capped at ₦1,000 per payment.',
          'Stablecoin payments: 0.5% of the amount, capped at $1 per payment.',
          'Payments made in the Money Moves app: free.',
          'Payouts from your business wallet to a bank: ₦100 each.',
        ],
      },
      'Fees are taken before a payment is settled and are not refunded when you refund a customer, unless we say otherwise. We may change our fees by telling you in advance; a change applies to payments made after it takes effect.',
    ],
  },
  {
    id: 'refunds',
    title: 'Refunds, disputes and fraud',
    body: [
      'Your customers are your customers. You are responsible for your own refund policy and for handling complaints and disputes with them. We are not a party to those disputes and do not decide them, though we may help where we can.',
      'You can refund a payment from your dashboard. A refund has to be funded, in one of the ways your dashboard offers, such as a bank transfer from you or a payment we are still holding. A refund is sent only once it is funded. Stablecoins sent on-chain cannot be reversed by anyone, and we cannot recover funds sent to the wrong address or network.',
      'You carry the loss on any payment that turns out to be fraudulent, unauthorised, disputed, reversed or recalled by a bank or other provider, together with any related cost, whether or not you have already delivered your goods. You must give us any information we ask for to deal with a dispute or an investigation.',
      'We may refund a customer ourselves where a payment was fraudulent, unauthorised, made in error or for something our rules do not allow. You must repay us what we refunded.',
    ],
  },
  {
    id: 'wallet',
    title: 'Your business wallet',
    body: [
      'Your business wallet is self-custodial. Its key is split so that no single party, including Money Moves, holds all of it, and we cannot move its funds on our own. In the same way, we cannot freeze, recover or reverse what is in it, and we cannot restore access if the people who control your business lose access to the email address or PIN that protect it.',
      'You are responsible for who can approve movements from your wallet, for keeping your PIN secret, and for checking every address and amount before you approve a send. A send you approve cannot be undone. We are not liable for any loss from your wallet, whatever its cause.',
    ],
  },
  {
    id: 'crypto',
    title: 'Stablecoins and blockchain networks',
    body: [
      'Stablecoins and blockchain networks are new technology and carry risk: a network can slow down, fork, fail or change its rules; a stablecoin can lose its link to the dollar or be frozen by its issuer; a smart contract can have flaws; and prices and rates move. Transactions on a blockchain are final.',
      'You accept these risks when you take stablecoin payments, hold stablecoins in your business wallet, or settle in them. We are not responsible for any loss caused by them, by a customer paying on the wrong network or to the wrong address, or by any network, issuer or wallet provider we do not control.',
      'Sending on a blockchain costs a network fee. A stablecoin issuer can freeze or block coins at any time, and we are not responsible if it does. Once a settlement reaches your business wallet or Money Moves username, we do not hold it and cannot reverse it.',
    ],
  },
  {
    id: 'api',
    title: 'The API',
    body: [
      'API keys belong to one mode. A test key only creates test payments; a live key creates real ones. Keep your keys secret and use them only from your own servers, never in a web page or an app. You are responsible for every request made with your keys, and for any loss if they are leaked. We may limit, suspend or revoke a key that is used in a way that puts you, your customers or us at risk, and we may change the API, with notice where we reasonably can.',
      'You are responsible for checking the signature on every webhook we send and for what your systems do with it. A webhook endpoint that keeps failing may be turned off, and events sent while it was off are not sent again by themselves. Software we publish under an open-source licence, such as our SDKs, is covered by that licence.',
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance and monitoring',
    body: [
      'We comply with the laws that apply to us, including those on anti-money laundering, counter-terrorism financing, sanctions and data protection. To do so we monitor and review payments, settlements, devices and account activity, keep records for as long as the law requires, and report suspicious activity to the authorities where we must. We may not be allowed to tell you when we do, and we are not liable to you for anything we do in good faith to meet these obligations.',
      <>You must not use Money Moves Business for anything illegal, or for anything on our list of {prohibitedLink}. You must not try to get around a limit, a check or a security measure, exploit a bug, or use the service for anyone else.</>,
    ],
  },
  {
    id: 'orders',
    title: 'Court orders and requests from authorities',
    body: [
      'We may hold, freeze, pay over or release money, and share information, when a court, regulator, law enforcement agency or other authority orders or asks us to, or when we reasonably believe the law requires it. We decide how to respond and do not have to challenge an order on your behalf. Money held this way stays held for as long as the order or investigation lasts. We are not liable to you for anything we do in good faith to comply.',
    ],
  },
  {
    id: 'data',
    title: 'Your data and your customers’ data',
    body: [
      'Each of us follows the data protection law that applies to it, including the Nigeria Data Protection Act 2023. When we run your checkout, we handle your customers’ data for you. For verification, fraud prevention, security and our legal obligations, we decide how it is used ourselves.',
      'You must tell your customers how you use their data and have a lawful reason for it. You own your customers’ data, and you let us use payment data to provide, secure and improve the service, to prevent fraud and to meet the law.',
    ],
  },
  {
    id: 'partners',
    title: 'Banks, networks and other partners',
    body: [
      'Parts of Money Moves Business rely on others: banks and payment partners, identity verification providers, wallet infrastructure, blockchain networks, and hosting and email providers. They set their own rules and may change, pause or end what they provide. We are not responsible for their acts, failures, delays or decisions, and we may change partners at any time. Where a bank, network or partner has rules for a payment, you must follow them too, and they apply if they conflict with these terms.',
    ],
  },
  {
    id: 'availability',
    title: 'Availability and changes to the service',
    body: [
      'We work to keep Money Moves Business running, but it may sometimes be slow, paused or unavailable, for maintenance, because of a partner or network, or for reasons outside our control. We may add, change, pause, limit or remove any feature, method, network or limit at any time. We are not liable for any loss caused by the service being unavailable or changed.',
    ],
  },
  {
    id: 'suspension',
    title: 'Suspension and closing your account',
    body: [
      'You can stop using Money Moves Business at any time and ask us to close your account.',
      'We may suspend or restrict your account, stop or hold settlements, refund customers, or close your account, with or without notice, if you break these terms, if we suspect fraud or other illegal activity, if verification is not completed or is withdrawn, if a partner, regulator or the law requires it, or if your account puts your customers, other users or us at risk. Where we can, and where the law allows, we will tell you why.',
      'You cannot close your account to avoid an investigation or something you owe. After an account is closed, or restricted because of risk, we may hold its balance and reserves for up to 120 days after its last payment, or for longer while refunds, disputes, investigations or amounts owed are still open.',
      'When an account is closed, we settle what is owed to you, less fees, refunds, reversals, reserves and any amount you owe us, unless the law or an investigation requires us to hold it. Records are kept as the law requires. Parts of these terms that by their nature should continue, including what you owe us, indemnity, limits on liability and disputes, continue after closing.',
    ],
  },
  {
    id: 'your-promises',
    title: 'What you confirm to us',
    body: [
      'You confirm, when you accept these terms and every time you use Money Moves Business, that:',
      {
        list: [
          'you have the authority to accept these terms for your business, and your business is lawfully set up and in good standing;',
          'everything you have told us is true, complete and current;',
          'you, your business and its owners and directors are not the subject of sanctions;',
          'none of them has had an account closed by a bank or payment provider for fraud or a breach of its rules in the last five years;',
          'you take payments only for your own business, and not for anyone else.',
        ],
      },
    ],
  },
  {
    id: 'warranties',
    title: 'No promises beyond these terms',
    body: [
      'We provide Money Moves Business with reasonable care and skill, but "as is" and "as available". To the extent the law allows, we make no other promise, stated or implied, about it, including that it will be uninterrupted, timely, secure or free of errors, that it will suit your business, or that any payment, rate or settlement time will be achieved.',
    ],
  },
  {
    id: 'liability',
    title: 'Limits on our responsibility',
    body: [
      'To the extent the law allows, we are not liable for any indirect, incidental, special or consequential loss, or for lost profits, revenue, sales, data, goodwill or business opportunity, however it arises.',
      'We are also not liable for loss caused by: your customers or your goods and services; a payment made on the wrong network, to the wrong address or for the wrong amount; a bank, partner, network, issuer or wallet provider; the loss or misuse of your login details, PIN or API keys; your business wallet; or anything outside our reasonable control.',
      'Our total liability to you for all claims together is limited to the fees you paid us in the three months before the first claim arose. Nothing in these terms limits liability that the law does not allow to be limited, such as for fraud.',
    ],
  },
  {
    id: 'indemnity',
    title: 'Covering us for your business',
    body: [
      'You agree to compensate and protect us, our directors, staff and partners from any loss, claim, demand, fine, penalty, cost or expense (including reasonable legal fees) that arises from: your business and what you sell; any claim by your customers or anyone else connected with your business; your breach of these terms or of any law; taxes connected with your sales; anything done through your account, your wallet or your API keys; and any fraudulent, disputed, reversed or recalled payment. This applies whether or not a claim succeeds, and continues after your account closes.',
    ],
  },
  {
    id: 'claims',
    title: 'Time limit for claims',
    body: [
      'If you think we got a payment, settlement, refund or fee wrong, tell us in writing within 60 days of when it happened. After that, to the extent the law allows, it is treated as correct and you cannot bring a claim about it.',
    ],
  },
  {
    id: 'ip',
    title: 'Intellectual property',
    body: [
      'Money Moves Business, including its software, design and content, belongs to us. We give you a limited, non-exclusive, non-transferable right to use it for your business while these terms apply. You may not copy, resell, reverse engineer or build a competing service from it. You keep the rights to your own name, logo and content, and let us show them where you use them, such as on your checkout and receipts. If you send us ideas or feedback, we may use them freely.',
      `We may name your business as a customer of Money Moves Business, with its name and logo. Email ${SUPPORT} if you would rather we did not.`,
    ],
  },
  {
    id: 'confidentiality',
    title: 'Confidentiality',
    body: [
      'Each of us keeps the other’s non-public information confidential, uses it only for this agreement, and shares it only with people who need it for that, or where the law requires. This continues for three years after your account closes, and for as long as information remains a trade secret.',
    ],
  },
  {
    id: 'force-majeure',
    title: 'Events outside our control',
    body: [
      'We are not responsible for any failure or delay caused by events outside our reasonable control, including failures of banks, payment partners, blockchain networks or the internet, power failures, cyberattacks, strikes, natural events, epidemics, war, unrest, and changes in law or the acts of any government or regulator.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: [
      'We may change these terms. We will tell you about material changes by email or in your dashboard before they take effect, unless a change is needed sooner by law or to protect the service. If you keep using Money Moves Business after a change takes effect, you accept it. If you do not agree, you must stop using it.',
    ],
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: [
      'These terms, and any dispute about them or about Money Moves Business, are governed by the laws of the Federal Republic of Nigeria. Before starting any formal process, we will both try in good faith to settle the dispute by talking to each other. A dispute that is not settled within 30 days shall be finally resolved by arbitration under the Arbitration and Mediation Act 2023, before a single arbitrator, seated in Lagos and conducted in English.',
      'Claims may only be brought individually, not as part of a group, class or representative action.',
    ],
  },
  {
    id: 'general',
    title: 'General',
    body: [
      'If any part of these terms is found to be unenforceable, the rest still applies. If we do not enforce a right straight away, we do not give it up. You may not transfer your rights under these terms without our written agreement; we may transfer ours to a company that takes over the service. These terms, with the pages they refer to, are the whole agreement between us about Money Moves Business. We may send you notices by email or in your dashboard, and a notice by email counts as received the next business day.',
      'You agree to receive this agreement, notices and records electronically. Our records of payments, settlements, refunds and account activity are evidence of what happened, unless they are clearly wrong. Nothing in these terms makes us partners, agents or employer and employee, and nobody else has rights under them. These terms are written in English, and the English version applies.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [`${COMPANY}, trading as Money Moves. Email ${SUPPORT}, or message us from the help chat in your dashboard.`],
  },
]

// ─── Privacy policy ───────────────────────────────────────────────────────

const PRIVACY: Section[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: [
      `${COMPANY}, trading as Money Moves, is responsible for the personal data described here. This policy covers Money Moves Business: the people who use the dashboard, the people who represent a business, and the customers who pay a business through our checkout. We process personal data in line with the Nigeria Data Protection Act 2023 and other laws that apply.`,
      'For the details a customer gives at a business’s checkout, we act for that business. For verification, fraud prevention, security and our legal obligations, we decide how data is used ourselves.',
    ],
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: [
      {
        list: [
          'Account details: your name, email address, phone number, how you sign in, and the businesses and roles you have.',
          'Business details: the business name, type, registration details, address, what it sells, and the documents you upload.',
          'Identity of the business representative: the result of an identity check, including a selfie and an identity document. We keep the result and the last four characters of the document number, not the selfie. Where we ask for a BVN, we keep it encrypted.',
          'Bank and wallet details: the bank accounts and wallets you pay out to, and the names their banks hold for them.',
          'Payments: amounts, references, times, and, for your customers, the name, email and phone they give at checkout and the name and bank of the account they paid from.',
          'Support: the messages and photos you send us in the help chat or by email.',
          'Device and usage: IP address, browser, pages used, and logs of sign-ins and important changes, which we keep to protect your account.',
          'Blockchain details: the wallet addresses and transactions connected with payments, settlements and returns.',
        ],
      },
      'We use one cookie, to keep you signed in. We do not use advertising cookies.',
    ],
  },
  {
    id: 'use',
    title: 'How we use it',
    body: [
      {
        list: [
          'To provide the service: opening accounts, taking payments, settling them, refunds, receipts and support.',
          'To verify businesses and the people behind them, and to meet our anti-money laundering, counter-terrorism financing and sanctions obligations.',
          'To prevent and investigate fraud and to keep accounts secure.',
          'To send you service messages: sign-in codes, receipts, payment and settlement updates, and changes to these policies.',
          'To improve the service, using information that does not identify you where we can.',
        ],
      },
      'We rely on our contract with you, our legal obligations, our legitimate interests in running a safe service, and, where it is needed, your consent. We do not sell personal data.',
      'We use automated checks to spot fraud and risk. A decision to refuse verification or close an account is made or reviewed by a person. We send product news only if you agree, and you can turn it off at any time; service messages continue while your account is open.',
    ],
  },
  {
    id: 'share',
    title: 'Who we share it with',
    body: [
      {
        list: [
          'Licensed banks and payment partners, to move money in and out.',
          'An identity verification provider, to check the identity of business representatives.',
          'Wallet infrastructure, email delivery and cloud hosting providers, to run the service.',
          'The business a customer pays, which sees that customer’s payment and the details they gave at checkout.',
          'Regulators, law enforcement and courts, where the law requires it.',
          'Professional advisers, and a buyer or successor if our business is sold or restructured.',
        ],
      },
      'Each provider may only use the data to do its work for us.',
    ],
  },
  {
    id: 'transfers',
    title: 'Data outside Nigeria',
    body: [
      'Some of our providers process data outside Nigeria. When data leaves Nigeria, we rely on safeguards recognised by the Nigeria Data Protection Act 2023 and its General Application and Implementation Directive, such as adequacy decisions or standard contractual clauses.',
    ],
  },
  {
    id: 'blockchain',
    title: 'Public blockchains',
    body: [
      'Wallet addresses and transactions on a public blockchain can be seen by anyone and cannot be changed or deleted, by us or by anyone else. A request to delete data cannot reach what is already recorded on a blockchain.',
    ],
  },
  {
    id: 'keep',
    title: 'How long we keep it',
    body: [
      'We keep personal data for as long as your account is open and then for as long as the law requires. Records of identity checks and transactions are kept for at least five years after the business relationship ends, as anti-money laundering law requires. Business records are never deleted early, so that payments and settlements can always be traced.',
    ],
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: [
      'Documents and BVNs are encrypted when stored. Passwords and sign-in codes are stored only in a form that cannot be read back. Access is limited to the people who need it, every look at a sealed BVN is recorded, and important actions are logged. No system is perfectly secure, so tell us at once if you think your account has been compromised. If a breach is likely to put your rights at risk, we tell the Nigeria Data Protection Commission within 72 hours of learning of it, and tell you without undue delay.',
    ],
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: [
      `You can ask to see the personal data we hold about you, to correct it, to have it deleted or restricted, to object to some uses, and to take a copy of it. Some data we must keep by law, even if you ask us to delete it. Email ${SUPPORT} to use these rights. We answer within 30 days, may ask you to prove who you are first, and you can ask us to look again at any answer. You can also complain to the Nigeria Data Protection Commission.`,
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: ['Money Moves Business is not for anyone under 18, and we do not knowingly collect their data.'],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: ['We may update this policy. We will tell you about material changes by email or in your dashboard.'],
  },
  {
    id: 'privacy-contact',
    title: 'Contact',
    body: [`Our data protection officer can be reached at ${SUPPORT}. Websites and services we link to have their own privacy policies, which this one does not cover.`],
  },
]

// ─── Prohibited businesses ────────────────────────────────────────────────

const PROHIBITED: Section[] = [
  {
    id: 'never',
    title: 'Never allowed',
    body: [
      {
        list: [
          'Anything illegal where you or your customers are, or that helps someone else break the law.',
          'Money laundering, terrorism financing, or getting around sanctions.',
          'Ponzi and pyramid schemes, "investment" schemes that promise guaranteed or unrealistic returns, get-rich-quick schemes, multi-level marketing that pays mainly for recruiting, and fake trading or recovery services.',
          'Fraud, scams, fake charities, and selling goods or services you do not intend to provide.',
          'Illegal drugs, drug paraphernalia, and prescription medicines sold without a licence.',
          'Weapons, ammunition, explosives and their parts, unless licensed and allowed by us in writing.',
          'Stolen goods, counterfeits, and anything that infringes someone else’s intellectual property.',
          'Fake or stolen documents, identities, accounts or payment details.',
          'Sexual content involving minors, non-consensual sexual content, and sexual services.',
          'Hate, violence or harassment against any person or group.',
          'Hacking tools, malware, and services for spam or unauthorised access.',
          'Fake reviews, testimonials or followers, and pretending to be another person, brand or business.',
          'Pirated content, unauthorised streaming including IPTV, and tickets bought by bots or resold unlawfully.',
          'Deepfakes and face or voice swaps of real people without their consent, and services that expose people’s personal data without consent.',
          'Tools that get around other services’ paywalls, security or limits, and services built to disguise traffic, such as IP spoofing or cloaking.',
          'Taking payments for other businesses, acting as a payment aggregator, or moving money between people for anything other than a sale, without our written agreement.',
          'Content aimed at children that is not suitable for them.',
        ],
      },
    ],
  },
  {
    id: 'permission',
    title: 'Allowed only with our written approval',
    body: [
      'These need a licence, extra checks, or both. Tell us before you take payments for any of them.',
      {
        list: [
          'Gambling, betting, lotteries and games of chance.',
          'Financial services: lending, investment, money transfer, foreign exchange, crypto trading or exchange, and holding money for others.',
          'Adult content and services.',
          'Alcohol, tobacco and vaping products.',
          'Pharmaceuticals, supplements and health products that make medical claims.',
          'Travel agencies, ticket resale, and memberships or subscriptions paid far in advance.',
          'Charities and fundraising.',
          'Credit repair and debt relief.',
          'Trading signals, investment courses and other financial education.',
        ],
      },
    ],
  },
  {
    id: 'enforcement',
    title: 'If a business breaks these rules',
    body: [
      'We may remove a product or link without notice, refuse or end verification, hold settlements for up to 120 days while we investigate, refund customers and recover those refunds from the business, report activity to the authorities where the law requires, and close the account. To report a business you think breaks these rules, email ' + SUPPORT + ' with what you saw. If you are not sure whether your business is allowed, ask us at ' + SUPPORT + ' before you start.',
    ],
  },
]

export function Terms() {
  return (
    <Page
      title="Terms of service"
      intro={<>These terms are also our merchant agreement. Read them with our {privacyLink} and the list of {prohibitedLink}.</>}
      sections={TERMS}
    />
  )
}

export function Privacy() {
  return <Page title="Privacy policy" intro="How Money Moves Business collects, uses and protects personal data, yours, your team's and your customers'." sections={PRIVACY} />
}

export function Prohibited() {
  return (
    <Page
      title="Prohibited businesses"
      intro="Money Moves Business is for genuine businesses selling legal goods and services. These are the things you can't use it for, and the things you can only use it for with our written approval."
      sections={PROHIBITED}
    />
  )
}
