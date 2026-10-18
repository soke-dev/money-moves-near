/**
 * Terms and privacy.
 *
 * The document itself is untouched - every section and every word is the legal
 * text that was already here. What is new is the frame: the app's own dark
 * ground, the display and mono pairing from the landing page, and a contents
 * list down the left that marks where you are as you read.
 *
 * A long agreement is easier to trust when you can see its shape, which is
 * what the list on the left is for.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const T = {
  paper: '#0A0C08',
  paperAlt: '#0F120B',
  card: '#141811',
  ink: '#ECEFE7',
  body: '#8B9580',
  faint: '#5C6650',
  rule: '#1F241A',
  deep: '#81FB02',
  dark: '#0A0C08',
}

const DISPLAY = "'Instrument Sans', system-ui, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace"

const PLAY_STORE = 'https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app'
const APP_STORE = 'https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053'

const SECTIONS: [string, string][] = [
  ["key-things-to-know", "Key Things to Know"],
  ["acceptance-of-terms", "Acceptance of Terms"],
  ["about-us", "About Us"],
  ["self-custodial-wallet-and-key-ownership", "Self-Custodial Wallet &amp; Key Ownership"],
  ["by-accessing-or-using-our-services", "BY ACCESSING OR USING OUR SERVICES"],
  ["use-of-the-services", "Use of the Services"],
  ["core-services", "Core Services"],
  ["eligibility-and-who-may-use-our-services", "Eligibility and Who May Use Our Services"],
  ["geographic-and-sanctioned-persons-restrictions", "Geographic &amp; Sanctioned Persons Restrictions"],
  ["prohibited-activities-aml-and-counter-terrorism-financing", "Prohibited Activities, AML &amp; Counter-Terrorism Financing"],
  ["user-account", "User Account"],
  ["identity-verification", "Identity Verification"],
  ["transaction-monitoring-and-settlement-rights", "Transaction Monitoring &amp; Settlement Rights"],
  ["privacy-policy", "Privacy Policy"],
  ["account-security", "Account Security"],
  ["wallet", "Wallet"],
  ["gasless-transactions", "Gasless Transactions"],
  ["crypto-savings-vault", "Crypto Savings Vault"],
  ["foreign-exchange-fluctuation", "Foreign Exchange Fluctuation"],
  ["currency-and-digital-asset-risks", "Currency &amp; Digital Asset Risks"],
  ["no-refund-and-no-recovery-policy", "No Refund &amp; No Recovery Policy"],
  ["third-party-service-providers", "Third-Party Service Providers"],
  ["account-termination", "Account Termination"],
  ["license-to-use-our-services", "License to Use Our Services"],
  ["non-solicitation-no-investment-advice", "Non-Solicitation; No Investment Advice"],
  ["assumption-of-risk", "Assumption of Risk"],
  ["intellectual-property-rights", "Intellectual Property Rights"],
  ["quality-or-accessibility-of-the-services", "Quality or Accessibility of the Services"],
  ["taxes", "Taxes"],
  ["account-breach", "Account Breach"],
  ["changes-and-termination", "Changes and Termination"],
  ["indemnity", "Indemnity"],
  ["disclaimers", "Disclaimers"],
  ["limitation-of-liability", "Limitation of Liability"],
  ["dispute-resolution", "Dispute Resolution"],
  ["class-action-waiver", "Class Action Waiver"],
  ["governing-law", "Governing Law"],
  ["miscellaneous", "Miscellaneous"],
  ["contact-information", "Contact Information"],
]

export default function Terms() {
  const [active, setActive] = useState(SECTIONS[0]?.[0] ?? '')

  // Arriving with a section named in the link (the footer's Privacy Policy): straight to it.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView())
  }, [])

  // Mark the section the reader is actually in, rather than the last one
  // clicked - a long document is usually scrolled, not navigated.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0]
        if (seen?.target.id) setActive(seen.target.id)
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    )
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  return (
    <div className="min-h-screen" style={{ background: T.paper, color: T.ink }}>
      {/* ── Nav ── */}
      <header
        className="sticky top-0 z-50 border-b backdrop-blur"
        style={{ borderColor: T.rule, background: 'rgba(10,12,8,0.9)' }}
      >
        <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between px-5">
          <Link to="/">
            <img src="/images/logo-mark.png" alt="Money Moves" className="h-[26px] w-auto sm:hidden" />
            <img src="/images/logo-lockup.png" alt="Money Moves" className="hidden h-[22px] w-auto sm:block" />
          </Link>

          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-[12px] transition-opacity hover:opacity-70"
              style={{ fontFamily: MONO, color: T.body }}
            >
              Home
            </Link>
            <GetTheApp />
          </div>
        </div>
      </header>

      {/* ── Title ── */}
      <div className="border-b" style={{ borderColor: T.rule, background: T.paperAlt }}>
        <div className="mx-auto max-w-[1200px] px-5 py-16">
          <span
            className="text-[10.5px] font-medium uppercase tracking-[0.22em]"
            style={{ fontFamily: MONO, color: T.deep }}
          >
            Legal
          </span>
          <h1
            className="mt-4 text-[38px] leading-[1.05] tracking-[-0.035em] sm:text-[52px]"
            style={{ fontFamily: DISPLAY, fontWeight: 600 }}
          >
            Terms of Use &amp; Privacy Policy
          </h1>
          <p className="mt-4 text-[12.5px]" style={{ fontFamily: MONO, color: T.faint }}>
            Last updated: 13 September 2026
          </p>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-16 lg:grid-cols-[280px_1fr] lg:gap-16">
        {/* Contents */}
        <aside className="lg:sticky lg:top-[92px] lg:h-[calc(100vh-120px)] lg:overflow-y-auto">
          <div
            className="mb-4 text-[10.5px] font-medium uppercase tracking-[0.22em]"
            style={{ fontFamily: MONO, color: T.faint }}
          >
            Contents
          </div>
          <nav className="flex flex-col">
            {SECTIONS.map(([id, title]) => {
              const on = id === active
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  className="border-l py-2 pl-4 text-[12.5px] leading-snug transition-colors"
                  style={{
                    fontFamily: MONO,
                    borderColor: on ? T.deep : T.rule,
                    color: on ? T.ink : T.body,
                  }}
                  dangerouslySetInnerHTML={{ __html: title }}
                />
              )
            })}
          </nav>
        </aside>

        {/* The agreement */}
        <div className="mm-legal min-w-0">
          <style>{`
            .mm-legal section { scroll-margin-top: 92px; padding-bottom: 34px; }
            .mm-legal h2 {
              font-family: ${DISPLAY}; font-weight: 600; font-size: 22px;
              letter-spacing: -0.02em; color: ${T.ink}; margin-bottom: 14px;
            }
            .mm-legal h3 { font-family: ${DISPLAY}; font-weight: 600; font-size: 16px; color: ${T.ink}; margin: 18px 0 8px; }
            .mm-legal p, .mm-legal li {
              font-family: ${MONO}; font-size: 12.5px; line-height: 2; color: ${T.body};
            }
            .mm-legal p { margin-bottom: 14px; }
            .mm-legal ul, .mm-legal ol { padding-left: 20px; margin-bottom: 14px; }
            .mm-legal li { margin-bottom: 8px; }
            .mm-legal strong { color: ${T.ink}; font-weight: 600; }
            .mm-legal a { color: ${T.deep}; text-decoration: underline; text-underline-offset: 3px; }
          `}</style>

          {/* Intro */}
          <section>
            <p className="text-muted-foreground">
              The following Terms and Conditions (these &quot;Terms&quot;) apply to any person that registers, utilises, and/or opens an account through Money Moves (mobile applications, website, or APIs). These Terms constitute a legally binding agreement between you and Money Moves (&quot;Money Moves,&quot; &quot;the Company,&quot; &quot;us,&quot; &quot;we,&quot; or &quot;our&quot;). Please read the Terms of Use carefully before you start to use the Services. It details our obligations to you and also highlights certain risks in using our services which you must consider carefully as you will be bound by the provisions of this Agreement through your use of this website or any of our services.
            </p>
          </section>

          {/* Key Things to Know */}
          <section id="key-things-to-know">
            <h2 className="text-2xl font-bold mb-4">Key Things to Know</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves is a self-custodial crypto finance app, which means your private keys and digital assets live on your device — not with us. Before you start using the Services, please take a moment to understand a few important points:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li><strong className="text-foreground">Transactions are final.</strong> Once an on-chain transaction is broadcast it cannot be reversed, cancelled, or refunded — including transfers sent to the wrong address.</li>
              <li><strong className="text-foreground">You hold your own keys.</strong> Your signing key is split into shares, one on your device and the others with our key management provider, so nobody holds a whole one. Export your keys whenever you like; if you hand an exported key to someone else, we have no way to undo what they do with it.</li>
              <li><strong className="text-foreground">Crypto values change.</strong> Digital asset prices can rise or fall sharply due to market conditions outside of our control.</li>
              <li><strong className="text-foreground">Services may change.</strong> Features may be paused, throttled, geographically restricted, or updated as we improve the product. You can export your keys at any time and use them elsewhere, so your funds remain reachable regardless of Service availability.</li>
              <li><strong className="text-foreground">We rely on partners.</strong> Some features depend on third parties such as blockchain networks, payment processors, airtime and bill-payment providers, and identity verification providers. If they have outages or policy changes, Service may be temporarily affected.</li>
            </ul>
            <p className="text-muted-foreground">
              By continuing to use the Services, you confirm that you&apos;ve read and agreed to these Terms in full.
            </p>
          </section>

          {/* Acceptance of Terms */}
          <section id="acceptance-of-terms">
            <h2 className="text-2xl font-bold mb-4">Acceptance of Terms</h2>
            <p className="text-muted-foreground mb-4">
              These Terms form a legally binding agreement between you and Money Moves. You are deemed to have accepted these Terms in their entirety when you do any of the following: (i) tick any box, button, or checkbox indicating your acceptance during sign-up or onboarding; (ii) create a Money Moves wallet or Account; (iii) download, install, launch, or otherwise use any Money Moves application, website, or API; or (iv) initiate any transaction or otherwise use any feature of the Services.
            </p>
            <p className="text-muted-foreground">
              Your continued use of the Services after these Terms are updated constitutes your acceptance of the updated Terms. If you do not agree with any part of these Terms or any future update, your sole remedy is to immediately stop using the Services and remove the application from your device. The self-custodial nature of your wallet means that ceasing to use the Services does not affect your ownership of the digital assets in it, provided you export your keys before you stop.
            </p>
          </section>

          {/* About Us */}
          <section id="about-us">
            <h2 className="text-2xl font-bold mb-4">About Us</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves is a self-custodial crypto finance app built for Africa and beyond. We provide a comprehensive suite of services that allow users to hold, spend, and manage their cryptocurrency without ever giving up custody of their private keys. Our services include multi-chain crypto deposits, instant bank cashouts, airtime and data top-ups, utility bill payments, peer-to-peer transfers by @username, onchain savings vaults, and referral rewards.
            </p>
            <p className="text-muted-foreground mb-4">
              Unlike custodial platforms, Money Moves is built on the principle that your crypto is yours. Your private keys are generated on your device, never transmitted to or stored on our servers, and remain under your sole control at all times. We do not have access to your wallet, your funds, or the ability to move your assets on your behalf.
            </p>
            <p className="text-muted-foreground">
              By accessing or using the Services, you signify that you have read, understand, and agree to be bound by this Agreement in its entirety. If you do not agree, you are not authorized to access or use the Services and should not use the Services.
            </p>
          </section>

          {/* Self-Custodial Nature */}
          <section id="self-custodial-wallet-and-key-ownership">
            <h2 className="text-2xl font-bold mb-4">Self-Custodial Wallet &amp; Key Ownership</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves is <strong className="text-foreground">self-custodial</strong>. This means:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Your signing key is generated as separate shares. One share is held on your device and the others by our key management provider, so that no single party, Money Moves included, ever holds a complete key or can reconstruct one alone.</li>
              <li>You are the sole custodian of your wallet. Money Moves does not hold a complete key, and cannot move, spend, freeze, or otherwise reach your funds at any time.</li>
              <li>Access to your wallet is restored by signing in with the email address your account is registered to. You are solely responsible for keeping that address secure and reachable, and for protecting any private keys you export. If you lose access to your registered email address, Money Moves cannot restore your wallet or your funds.</li>
              <li>Money Moves cannot freeze, seize, reverse, or otherwise interfere with any transaction initiated from your wallet. All onchain transactions are final and irreversible.</li>
              <li>Money Moves does not act as a custodian, trustee, fiduciary, or intermediary with respect to your digital assets.</li>
              <li>You may export your private keys at any time from Account, then Security, and use them in any compatible wallet, with or without the Money Moves application.</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong className="text-foreground">YOU ACKNOWLEDGE AND AGREE THAT MONEY MOVES HAS NO ABILITY TO ACCESS, RECOVER, REVERSE, OR REFUND ANY CRYPTOCURRENCY OR DIGITAL ASSETS IN YOUR WALLET. IF YOUR WALLET IS COMPROMISED, HACKED, OR IF YOU LOSE ACCESS TO YOUR REGISTERED EMAIL ADDRESS OR TO ANY PRIVATE KEYS YOU HAVE EXPORTED, MONEY MOVES BEARS NO RESPONSIBILITY AND CANNOT RESTORE YOUR FUNDS UNDER ANY CIRCUMSTANCES.</strong>
            </p>
          </section>

          {/* Services */}
          <section id="by-accessing-or-using-our-services">
            <h2 className="text-2xl font-bold mb-4">BY ACCESSING OR USING OUR SERVICES</h2>
            <p className="text-muted-foreground">
              BY ACCESSING OR USING OUR SERVICES, WHICH INCLUDE OUR VARIOUS WEBSITES (AND ANY RESPECTIVE SUBDOMAINS); APPLICATIONS (COLLECTIVELY WITH ANY MATERIALS AND SERVICES AVAILABLE THEREIN, AND SUCCESSOR WEBSITE(S) OR APPLICATION(S), AND OTHER SERVICES THAT LINK TO THESE TERMS, AS WELL AS ANY INFORMATION, TEXT, LINKS, GRAPHICS, PHOTOS, AUDIO, VIDEO, OR OTHER MATERIALS STORED, RETRIEVED OR APPEARING THEREON, WHETHER ACCESSED THROUGH THE SITE OR OTHERWISE (COLLECTIVELY, THE &quot;SERVICES&quot;), YOU ARE ENTERING INTO A BINDING AGREEMENT WITH US THAT INCLUDES THESE TERMS, PRIVACY POLICY AND OTHER POLICIES REFERENCED HEREIN.
            </p>
          </section>

          {/* Use of Services */}
          <section id="use-of-the-services">
            <h2 className="text-2xl font-bold mb-4">Use of the Services</h2>
            <p className="text-muted-foreground mb-4">
              You must be able to enter into an Agreement lawfully in order to utilize our Services. You affirm and warrant that you satisfy the eligibility criterion by using the Services. You must not use our Services or access them if you do not meet the criterion.
            </p>
            <p className="text-muted-foreground mb-4">
              Additionally, you affirm and guarantee that you are authorized to enter into this Agreement on behalf of the entity or organization that you are sworn to represent in your jurisdiction, as well as on your behalf. If any of these requirements are not met, you are not allowed to use or access the Services.
            </p>
            <p className="text-muted-foreground">
              Money Moves provides a self-custodial wallet and payment facilitation services that allow you to store, save, and spend crypto for the purchase of goods and services, pay utility bills, buy airtime and data, and transfer funds to Nigerian bank accounts. We are not a bank and do not offer banking services as defined by the Banks and Other Financial Institutions Act, 2020. We do not hold or custody your funds.
            </p>
          </section>

          {/* Core Services */}
          <section id="core-services">
            <h2 className="text-2xl font-bold mb-4">Core Services</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves is a self-custodial crypto finance app and payment platform that enables you to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Multi-Chain Deposits:</strong> Receive and store USDC, USDT, and other supported digital assets across multiple networks.</li>
              <li><strong className="text-foreground">Instant Bank Cashout:</strong> Convert crypto to naira and withdraw to any Nigerian bank account in under 30 seconds.</li>
              <li><strong className="text-foreground">Airtime &amp; Data Top-Up:</strong> Recharge MTN, Airtel, Glo, or 9mobile directly from your crypto balance.</li>
              <li><strong className="text-foreground">Bill Payments:</strong> Pay electricity, DStv, GOtv, StarTimes, and other utility bills from your wallet.</li>
              <li><strong className="text-foreground">Send by @Username:</strong> Send crypto to other Money Moves users using just their @username.</li>
              <li><strong className="text-foreground">Crypto Savings Vault:</strong> Lock your crypto in a secure onchain savings vault with flexible or fixed terms. A 0.5% lock fee applies.</li>
              <li><strong className="text-foreground">Referrals &amp; Leaderboard:</strong> Earn crypto rewards by referring friends and climbing the leaderboard.</li>
              <li><strong className="text-foreground">Gasless Transactions:</strong> All onchain transactions are settled with zero gas fees — we sponsor all network costs.</li>
            </ul>
          </section>

          {/* Eligibility */}
          <section id="eligibility-and-who-may-use-our-services">
            <h2 className="text-2xl font-bold mb-4">Eligibility and Who May Use Our Services</h2>
            <p className="text-muted-foreground mb-4">
              You may use the Services only if you agree to form a binding contract with Money Moves and are not a person barred from receiving services under the laws of the applicable jurisdiction. If you are accepting these Terms and using the Services on behalf of a company, business, or organisation, you represent and warrant that you are authorised to do so.
            </p>
            <p className="text-muted-foreground mb-4">By using the Services, you represent that:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>You have attained the age of 18 years;</li>
              <li>You are of sound mind and have the capacity to enter into a legally binding contract;</li>
              <li>All personal information that you provide about yourself is accurate and true to the best of your knowledge, and you have the responsibility to maintain the accuracy of the information at all times;</li>
              <li>You have carefully considered the risks involved with using the Services, including the risks of self-custody;</li>
              <li>Your use of the Services does not violate any applicable law or regulation;</li>
              <li>You understand that Money Moves is a self-custodial finance app and that you are solely responsible for the security of your device, your registered email address, any private keys you export, and your funds.</li>
            </ul>
          </section>

          {/* Geographic & Sanctioned Persons Restrictions */}
          <section id="geographic-and-sanctioned-persons-restrictions">
            <h2 className="text-2xl font-bold mb-4">Geographic &amp; Sanctioned Persons Restrictions</h2>
            <p className="text-muted-foreground mb-4">
              The Services are not offered, and you may not use the Services, if you are located in, ordinarily resident in, organised under the laws of, or accessing the Services from any country, territory, or jurisdiction that is the subject of comprehensive sanctions administered by the United States Office of Foreign Assets Control (OFAC), the United Nations Security Council, the European Union, the United Kingdom, or other relevant authorities, including but not limited to Cuba, Iran, North Korea, Syria, the Crimea, Donetsk, Luhansk and Zaporizhzhia regions of Ukraine, and any other jurisdiction Money Moves designates from time to time.
            </p>
            <p className="text-muted-foreground mb-4">
              You represent, warrant, and covenant that: (a) you are not, and are not acting on behalf of, any person listed on any sanctions list maintained by the foregoing authorities or by the Nigerian Sanctions Committee; (b) you are not located in or a national of any restricted jurisdiction; (c) you will not use the Services to transact with, on behalf of, or for the benefit of any restricted person or jurisdiction; and (d) you will not use any VPN, proxy, anonymising service, or other means to disguise your location in order to access the Services from a restricted jurisdiction.
            </p>
            <p className="text-muted-foreground">
              Money Moves reserves the right, in its sole discretion, to refuse, restrict, suspend, or terminate access to the Services to any user or in any jurisdiction without prior notice and without liability.
            </p>
          </section>

          {/* Prohibited Activities & AML */}
          <section id="prohibited-activities-aml-and-counter-terrorism-financing">
            <h2 className="text-2xl font-bold mb-4">Prohibited Activities, AML &amp; Counter-Terrorism Financing</h2>
            <p className="text-muted-foreground mb-4">
              You agree that you will not use the Services, directly or indirectly, in connection with any of the following, each of which is strictly prohibited:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li>Money laundering, terrorist financing, proliferation financing, bribery, corruption, tax evasion, fraud, market manipulation, or any other criminal activity;</li>
              <li>Transactions involving proceeds of crime, stolen property, illicit goods or services, or any source of funds you cannot lawfully account for;</li>
              <li>Transactions that violate any applicable law, regulation, or sanctions regime, including the Money Laundering (Prevention and Prohibition) Act 2022, the Terrorism (Prevention and Prohibition) Act 2022, the Nigeria Data Protection Act 2023, and any successor legislation;</li>
              <li>Operating, financing, or transacting on behalf of any unlicensed money services business, virtual asset service provider, P2P trading desk, gambling operation, mixing or tumbling service, darknet market, ransomware payment, scam, or Ponzi/pyramid scheme;</li>
              <li>Funding, transferring, or receiving value on behalf of any third party (acting as a money mule, nominee, or front for another person);</li>
              <li>Impersonating any person, providing false identification, or using another person&apos;s identity documents, bank account, BVN, or wallet;</li>
              <li>Circumventing, attempting to circumvent, or assisting any other person to circumvent, any KYC, transaction limit, geographic restriction, or security measure imposed by Money Moves;</li>
              <li>Attempting to exploit bugs, manipulate rates, abuse referrals, double-spend, replay transactions, or otherwise gain any unintended advantage; or</li>
              <li>Using the Services in a manner inconsistent with their intended purpose as set out in these Terms.</li>
            </ul>
            <p className="text-muted-foreground mb-4">
              You acknowledge that Money Moves is subject to anti-money laundering, counter-terrorism financing, and sanctions obligations under Nigerian and international law. You agree to cooperate fully with any reasonable request from Money Moves for information, documentation, or explanation regarding any transaction, source of funds, source of wealth, beneficial ownership, or purpose of use.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Violation of this section is a material breach.</strong> Money Moves may, without notice and without liability, suspend or terminate your Account, refuse, delay, reverse (where technically possible) or cancel any fiat settlement or off-platform payment, report you and your activity to law enforcement, regulators, financial institutions, or other affected parties, and pursue any other remedy available at law or equity.
            </p>
          </section>

          {/* User Account */}
          <section id="user-account">
            <h2 className="text-2xl font-bold mb-4">User Account</h2>
            <p className="text-muted-foreground mb-4">
              In creating an Account, you must provide us with accurate and complete registration information as prompted during the registration process, including your name, a valid email address, phone number, and a @username of your choice. Each Account registration is for a single user only. You shall not misrepresent your identity or your affiliation with any person or organisation and you are not allowed to use another user&apos;s Account for any purpose whatsoever.
            </p>
            <p className="text-muted-foreground">
              It is your responsibility to ensure your contact information is accurate and up to date. You can contact us directly at support@usemoneymoves.xyz to update your information.
            </p>
          </section>

          {/* Identity Verification */}
          <section id="identity-verification">
            <h2 className="text-2xl font-bold mb-4">Identity Verification</h2>
            <p className="text-muted-foreground mb-4">
              You are required to provide valid identification documents to be verified before certain transactions can be carried out in your account. Such identification documents include your Bank Verification Number (BVN) and a valid Identification document such as a Driver&apos;s License, Voter&apos;s Card, National Identification Number (NIN), and International Passport. Your account will be restricted to certain limits if your identity is not verified.
            </p>
            <p className="text-muted-foreground mb-4">Money Moves reserves the right, at any time, to:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Restrict or suspend your account when we, in our sole discretion, consider it necessary to carry out further Identity Verification and/or Enhanced Due Diligence (EDD); or</li>
              <li>Terminate your account if you provide, or we suspect you have provided, false information or refuse to provide the information we require for Identity Verification and/or EDD.</li>
            </ul>
          </section>

          {/* Transaction Monitoring & Fiat Settlement Rights */}
          <section id="transaction-monitoring-and-settlement-rights">
            <h2 className="text-2xl font-bold mb-4">Transaction Monitoring &amp; Settlement Rights</h2>
            <p className="text-muted-foreground mb-4">
              You expressly acknowledge and agree that, while your crypto wallet is self-custodial and outside of our control, Money Moves operates the fiat-settlement, bill-payment, and airtime-purchase layers of the Services through licensed third parties and regulated rails. With respect to those services, Money Moves may, in its sole discretion and without prior notice:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-4">
              <li>Monitor, screen, sample, review, profile, or analyse any transaction, account behaviour, device, IP address, or counter-party for fraud, sanctions, AML, CTF, or risk-management purposes;</li>
              <li>Request additional information, documentation, source-of-funds or source-of-wealth evidence at any time, and impose enhanced due diligence (EDD) measures;</li>
              <li>Delay, hold, decline, reverse, or refund any fiat payout (including bank transfers, bill payments, airtime, data, or other off-platform payments) where Money Moves reasonably suspects fraud, error, sanctions exposure, AML/CTF risk, account compromise, or breach of these Terms;</li>
              <li>Cap, throttle, lower, or suspend transaction or withdrawal limits, whether globally or for individual accounts, with or without notice;</li>
              <li>Share information about you, your transactions, devices, and counter-parties with law enforcement, regulators, banks, payment processors, courts, fraud-prevention networks, KYC vendors, and affected third parties, where required by law or reasonably necessary to investigate or prevent suspected illegal or harmful activity; and</li>
              <li>Permanently retain transaction records, KYC data, and related metadata for the period required by applicable Nigerian and international AML, tax, accounting, and consumer-protection laws, regardless of account termination.</li>
            </ul>
            <p className="text-muted-foreground">
              You waive any claim against Money Moves for any loss, damage, inconvenience, or expense arising from any action taken under this section in good faith, and you confirm that the foregoing rights are in addition to, and not in lieu of, any other rights or remedies Money Moves has under these Terms or at law.
            </p>
          </section>

          {/* Privacy Policy */}
          <section id="privacy-policy">
            <h2 className="text-2xl font-bold mb-4">Privacy Policy</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves processes personal data in accordance with the Nigeria Data Protection Act 2023 (NDPA) and other applicable laws. This section summarises how we collect, use, share, and protect your personal data. By using the Services you consent to such processing.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Information We Collect</h3>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li><strong className="text-foreground">Account &amp; Profile:</strong> name, email, phone number, username, date of birth, and profile picture (optional).</li>
              <li><strong className="text-foreground">KYC &amp; Identity:</strong> BVN, NIN, government-issued ID, address, and other documents required to verify your identity, processed by our licensed KYC vendor.</li>
              <li><strong className="text-foreground">Transaction Data:</strong> wallet addresses, on-chain transaction hashes, fiat amounts, bank account details for payouts, bill recipient details, and timestamps.</li>
              <li><strong className="text-foreground">Device &amp; Usage:</strong> device model, OS, IP address, app version, crash logs, analytics events, and approximate location.</li>
              <li><strong className="text-foreground">Communications:</strong> support tickets, in-app messages, and any feedback you submit.</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong className="text-foreground">We do not hold a complete signing key and we do not store your PIN.</strong> Your PIN is set and checked on your device, and key shares are held separately so that no single party can assemble a whole key.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Biometric &amp; Face Data</h3>
            <p className="text-muted-foreground">
              During KYC, facial data (including biometric data for facial recognition and liveness checks) may be processed by our third-party verification provider for the sole purposes of identity verification and fraud prevention. Money Moves does not collect, store, or retain this biometric data. All biometric data is processed by our verification provider in accordance with applicable data protection laws.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">How We Use Your Data</h3>
            <p className="text-muted-foreground">
              We use your data to: provide and improve the Services; verify your identity; process transactions; detect, prevent and investigate fraud, AML, CTF, sanctions, and other prohibited activity; provide customer support; send service-related and (with your consent) marketing communications; comply with our legal, regulatory, audit, and tax obligations; and enforce these Terms.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Sharing &amp; Disclosure</h3>
            <p className="text-muted-foreground">
              We share personal data only with: (i) our payment, banking, KYC, blockchain infrastructure, push-notification, email, and analytics providers, who are contractually bound to protect it; (ii) law enforcement, regulators, courts, and other authorities where required by law, subpoena, court order, or to protect our or others&apos; rights, property, or safety; and (iii) successors in interest if Money Moves is acquired, merged, or restructured. We do not sell your personal data.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Data Retention &amp; Security</h3>
            <p className="text-muted-foreground">
              We retain personal data for as long as your Account is active and afterwards for as long as required to comply with our legal, regulatory, and audit obligations (which, for AML and tax purposes, is typically a minimum of five (5) years from the date of the relevant transaction). We use industry-standard administrative, technical, and physical safeguards to protect your data, but no system is perfectly secure and we cannot guarantee absolute security.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Your Rights</h3>
            <p className="text-muted-foreground">
              Subject to applicable law, you may request access to, correction of, or deletion of your personal data, withdraw consent to non-essential processing, or lodge a complaint with the Nigeria Data Protection Commission (NDPC). To exercise these rights, contact <a href="mailto:support@usemoneymoves.xyz" className="text-primary hover:underline">support@usemoneymoves.xyz</a>. We may refuse requests where retention is required by law, where data is necessary for fraud prevention or dispute resolution, or where the request would unreasonably impact others&apos; rights.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">International Transfers</h3>
            <p className="text-muted-foreground">
              Some of our service providers process data outside Nigeria. Where we transfer personal data abroad, we rely on adequacy decisions, standard contractual clauses, or other lawful transfer mechanisms recognised under the NDPA.
            </p>
          </section>

          {/* Account Security */}
          <section id="account-security">
            <h2 className="text-2xl font-bold mb-4">Account Security</h2>
            <p className="text-muted-foreground mb-4">By creating an Account, you consent to the following guidelines to safeguard the security of your Account:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>You shall not share your Account login details, sign-in codes, PIN, or any exported private keys, nor let anyone else access your Account or wallet.</li>
              <li>In the event you become aware of or reasonably suspect any breach of security, including without limitation any loss, theft, or unauthorized use of your Account, wallet, or private keys, you will immediately notify us at support@usemoneymoves.xyz.</li>
              <li>You are solely responsible for maintaining the confidentiality of your registered email address, the sign-in codes we send to it, your PIN, and any private keys you export. Money Moves does not use passwords; access to your email address is access to your account.</li>
              <li>You are responsible for anything that happens on your Account and wallet, whether or not such actions were taken by you. Money Moves cannot reverse, refund, or undo any onchain transaction.</li>
              <li>You acknowledge that Money Moves may suspend your access to or terminate your use of the Service if someone else uses it to engage in any activity that violates these Terms.</li>
            </ul>
          </section>

          {/* Wallet */}
          <section id="wallet">
            <h2 className="text-2xl font-bold mb-4">Wallet</h2>
            <p className="text-muted-foreground mb-4">
              The Service provides each User with a self-custodial Wallet whose signing key is split into shares held by your device and our key management provider. Money Moves never holds a complete key and cannot assemble one. Users are free to use the Wallet to execute transactions from the Platform. Users may credit or debit the Wallet with supported cryptocurrency assets at any time.
            </p>
            <p className="text-muted-foreground mb-4">
              <strong className="text-foreground">Money Moves shall not be held liable for the loss or theft of exported private keys, sign-in codes, email access, or login information of the User, or by the resulting Wallet impersonation, unauthorized access, or loss of funds. Since Money Moves never holds a complete key, we are technically unable to recover, restore, freeze, or refund any assets in your wallet under any circumstances whatsoever.</strong>
            </p>
            <p className="text-muted-foreground">
              You may export your private keys at any time and use them in any compatible wallet, with or without the Money Moves application. Your wallet and its contents belong entirely to you.
            </p>
          </section>

          {/* Gasless Transactions */}
          <section id="gasless-transactions">
            <h2 className="text-2xl font-bold mb-4">Gasless Transactions</h2>
            <p className="text-muted-foreground">
              Money Moves sponsors all network (gas) fees for onchain transactions initiated through the application. You will never be charged gas fees when using Money Moves. However, Money Moves reserves the right to modify, limit, or discontinue gas sponsorship at any time, with or without notice, and for any reason. Should gas sponsorship be modified or discontinued, standard network fees may apply to your transactions.
            </p>
          </section>

          {/* Savings Vault */}
          <section id="crypto-savings-vault">
            <h2 className="text-2xl font-bold mb-4">Crypto Savings Vault</h2>
            <p className="text-muted-foreground">
              The Crypto Savings Vault is an onchain smart contract that allows you to lock your crypto for a specified period. A 0.5% lock fee is deducted from the locked amount at the time of locking. Locked funds are held in the onchain smart contract — not by Money Moves. Upon maturity, you may withdraw your funds directly from the contract. Money Moves does not have custody or control over funds in the savings vault. Smart contracts, while audited, carry inherent risks including potential bugs or vulnerabilities. You acknowledge these risks and agree that Money Moves is not liable for any loss arising from the use of onchain savings vaults.
            </p>
          </section>

          {/* Exchange Rate Fluctuation */}
          <section id="foreign-exchange-fluctuation">
            <h2 className="text-2xl font-bold mb-4">Foreign Exchange Fluctuation</h2>
            <p className="text-muted-foreground">
              Exchange rates fluctuate constantly and thereby give rise to risk and uncertainty. We will publish the applicable exchange rates at which we settle transactions. You agree that your transactions on the Platform shall be effected and settled at the prevailing rate at the time of transaction. For the avoidance of doubt, this means that at certain times, the exchange rate at which you make deposits will not be the exchange rate at which your withdrawals will be settled. Without prejudice to the foregoing, you agree that you will not trade, hedge, or participate in any activity that will impair the delivery of our Services or interfere with the use of our services by other persons.
            </p>
          </section>

          {/* Currency Risks */}
          <section id="currency-and-digital-asset-risks">
            <h2 className="text-2xl font-bold mb-4">Currency &amp; Digital Asset Risks</h2>
            <p className="text-muted-foreground mb-4">By using the Platform, you acknowledge to be aware of the following:</p>
            <p className="text-muted-foreground mb-4">
              Cryptocurrencies and self-custodial wallet services rely on emerging technologies presenting risk of failure, bugs, or malfunction. Digital currency services are not currently fully regulated by the Central Bank of Nigeria or any other regulator. Carefully consider whether trading or holding digital assets is suitable for your risk appetite.
            </p>
            <p className="text-muted-foreground mb-4">
              Digital asset markets can be volatile, and prices can fluctuate significantly, which could result in sudden and significant increases or decreases in the value of your assets. You should carefully assess whether your financial situation and risk tolerance are suitable for digital assets. You are solely responsible for any decision to send, convert, or otherwise hold or deal with digital assets. Money Moves does not, and will not, offer you any financial advice in connection with your use of or transactions conducted through the platform.
            </p>
            <p className="text-muted-foreground">
              You indemnify Money Moves, its operating entities, or any other affiliates (including their respective directors, members, employees, or agents), to the maximum extent permitted by law, against any loss, liability, action, cost, claim, damages, proceedings, or expense that you may suffer, directly or indirectly, in connection with your Money Moves account (without limitation) the loss of digital currencies (whether in whole or in part). You accordingly hereby waive any claim that you may have against Money Moves arising therefrom (including in respect of claim for direct, indirect, consequential, or pecuniary damages).
            </p>
          </section>

          {/* No Refund Policy */}
          <section id="no-refund-and-no-recovery-policy">
            <h2 className="text-2xl font-bold mb-4">No Refund &amp; No Recovery Policy</h2>
            <p className="text-muted-foreground mb-4">
              <strong className="text-foreground">Due to the self-custodial nature of Money Moves, all cryptocurrency transactions are final and irreversible. Money Moves does not and cannot:</strong>
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Issue refunds for any cryptocurrency transactions, whether initiated by you or a third party;</li>
              <li>Reverse, cancel, or modify any onchain transaction once it has been broadcast to the blockchain;</li>
              <li>Recover funds sent to incorrect wallet addresses;</li>
              <li>Recover funds lost due to wallet compromise, hacking, phishing, social engineering, or any unauthorized access;</li>
              <li>Recover funds lost due to exported private keys that are lost or stolen, or loss of access to your registered email address;</li>
              <li>Compensate users for losses arising from smart contract bugs, blockchain network failures, or third-party service outages;</li>
              <li>Compensate users for losses arising from market volatility, exchange rate fluctuations, or the depreciation of any digital asset.</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              <strong className="text-foreground">YOU ACKNOWLEDGE AND AGREE THAT YOU USE MONEY MOVES AT YOUR OWN RISK AND THAT MONEY MOVES SHALL HAVE NO LIABILITY WHATSOEVER FOR ANY LOSS OF FUNDS, REGARDLESS OF THE CAUSE, INCLUDING BUT NOT LIMITED TO HACKING, UNAUTHORIZED ACCESS, LOSS OF PRIVATE KEYS, SMART CONTRACT VULNERABILITIES, NETWORK FAILURES, OR USER ERROR.</strong>
            </p>
          </section>

          {/* Third Party */}
          <section id="third-party-service-providers">
            <h2 className="text-2xl font-bold mb-4">Third-Party Service Providers</h2>
            <p className="text-muted-foreground">
              We occasionally collaborate with third parties to provide you with more opportunities to use our services. Instances of these collaborations include partnerships with payment platforms, blockchain networks, KYC providers, bill payment aggregators, and financial institutions which help to power our services. Our partners reserve the right, in their sole discretion, to alter, amend, suspend, terminate, or change the terms and conditions of any program they provide, in whole or in part, at any time, with or without prior notice. You acknowledge and agree that as a result of such action by any partner, Money Moves shall have no obligation to you.
            </p>
          </section>

          {/* Account Termination */}
          <section id="account-termination">
            <h2 className="text-2xl font-bold mb-4">Account Termination</h2>
            <p className="text-muted-foreground mb-4">
              Money Moves reserves the right to immediately terminate or suspend your account and/or access to the service for any reason, including a violation of these Terms, the use of temporary or disposable email services, failure to complete KYC obligations, invalid email addresses, or use of VPNs to circumvent geographic restrictions.
            </p>
            <p className="text-muted-foreground mb-4">
              You may discontinue your use of the Service at any time. Since your wallet is self-custodial, you may export your keys before you go, and any keys you have exported continue to control your funds after account termination. Money Moves is in no way liable to you for the effects of any termination or cancellation on your use of the Service.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Upon account termination, you retain full ownership and control of your wallet and all digital assets therein. Money Moves cannot and will not seize, freeze, or confiscate your funds at any time.</strong>
            </p>
          </section>

          {/* License */}
          <section id="license-to-use-our-services">
            <h2 className="text-2xl font-bold mb-4">License to Use Our Services</h2>
            <p className="text-muted-foreground mb-4">
              We grant you a personal, revocable, non-exclusive, and non-assignable license to access and use the Service, subject to your continued compliance with the Agreement. This license&apos;s primary function is to enable you to use and make use of the Services in accordance with the Terms.
            </p>
            <p className="text-muted-foreground mb-4">You shall not:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Rent, lease, loan, resell, sublicense, distribute, or otherwise transfer the Application to any third party;</li>
              <li>Make any copies of the Application;</li>
              <li>Make any alterations that may interfere with the service provided;</li>
              <li>Obtain unauthorised access to a third party&apos;s account or the Money Moves database;</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Application.</li>
            </ul>
          </section>

          {/* Non-Solicitation */}
          <section id="non-solicitation-no-investment-advice">
            <h2 className="text-2xl font-bold mb-4">Non-Solicitation; No Investment Advice</h2>
            <p className="text-muted-foreground">
              The only purpose of any information given in conjunction with your access to and use of the Services is informative. The information on the Services should not be used as the basis for any financial decision you make. You should seek independent professional advice from a licensed and competent expert in your jurisdiction before making any financial, legal, technological, or other decisions affecting the Services. Money Moves does not provide investment advice, financial advice, trading advice, or any other sort of advice. You are solely responsible for determining whether any investment, investment strategy, or related transaction is appropriate for you based on your personal investment objectives, financial circumstances, and risk tolerance.
            </p>
          </section>

          {/* Assumption of Risk */}
          <section id="assumption-of-risk">
            <h2 className="text-2xl font-bold mb-4">Assumption of Risk</h2>
            <p className="text-muted-foreground mb-4">
              You are aware that using the Services carries inherent risks, including but not limited to the risks of self-custody, smart contract vulnerabilities, blockchain network congestion or failure, and market volatility. All decisions regarding the Services are solely your responsibility, and you are not entitled to a refund for any transactions you execute through the Services.
            </p>
            <p className="text-muted-foreground mb-4">
              The Services may be blocked, interrupted, or negatively impacted by sophisticated cyberattacks, activity spikes, computer viruses, and/or other operational or technical issues. We make no continuous commitment to alert you to all hazards associated with using and accessing our services. You acknowledge that you are taking these risks and that you will not attempt to have Money Moves indemnify any party for any ensuing losses.
            </p>
            <p className="text-muted-foreground">
              You acknowledge that we are not responsible for monitoring or maintaining the security of your wallet, your device, or any private keys you export, and you acknowledge and accept that we are not liable for any unauthorized access to your wallet and that you will not hold us accountable for it.
            </p>
          </section>

          {/* IP */}
          <section id="intellectual-property-rights">
            <h2 className="text-2xl font-bold mb-4">Intellectual Property Rights</h2>
            <p className="text-muted-foreground mb-4">
              All rights to the Services are ours. Any rights, titles, and interests in the Services that you may access or use are owned by us, including without limitation any copyrights in and to any content, code, data, or other materials. You shall not:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Copy, reproduce, publish, display, perform, post, transmit, or distribute any part of the Content in any form or by any means except as expressly permitted herein;</li>
              <li>Modify, create derivative works from, translate, adapt, disassemble, reverse compile, or reverse engineer any part of the Content;</li>
              <li>Sell, license, sublicense, transfer, assign, rent, lease, loan, host, or otherwise exploit the Content or the Services in any way;</li>
              <li>Delete or alter any copyright, trademark, or other proprietary rights notices from copies of the Content.</li>
            </ul>
          </section>

          {/* Service Availability */}
          <section id="quality-or-accessibility-of-the-services">
            <h2 className="text-2xl font-bold mb-4">Quality or Accessibility of the Services</h2>
            <p className="text-muted-foreground">
              You must acknowledge, understand, and agree that the Services may occasionally be unavailable or inoperable for any reason, including but not limited to equipment failures, routine maintenance, causes outside our control, disruptions, temporary or permanent unavailability of underlying blockchain infrastructure, or unavailability of third-party services. You understand and accept that using and accessing the Services is at your own risk. You should not participate in any transactions unless they are appropriate given your situation and available resources.
            </p>
          </section>

          {/* Taxes */}
          <section id="taxes">
            <h2 className="text-2xl font-bold mb-4">Taxes</h2>
            <p className="text-muted-foreground">
              You are solely responsible for determining whether and to what extent any taxes apply to any transactions you carry out through your Money Moves Account and for withholding, collecting, reporting, and remitting the correct tax amounts to the appropriate tax authorities.
            </p>
          </section>

          {/* Account Breach */}
          <section id="account-breach">
            <h2 className="text-2xl font-bold mb-4">Account Breach</h2>
            <p className="text-muted-foreground">
              Should you suspect that your Account or any of your details have been compromised, or you become aware of any fraud or attempted fraud or any other security incident affecting you and/or Money Moves, you must notify us immediately by email at support@usemoneymoves.xyz and continue to provide information throughout the breach. You must take the required steps to minimize and report any breach, including changing your PIN, securing the email address your account is registered to, and moving your funds using an exported key if you believe your device is compromised. Note that due to the self-custodial nature of the wallet, Money Moves cannot freeze or recover compromised funds.
            </p>
          </section>

          {/* Changes */}
          <section id="changes-and-termination">
            <h2 className="text-2xl font-bold mb-4">Changes and Termination</h2>
            <p className="text-muted-foreground mb-4">We may, at any time without notice or liability, and for any reason whatsoever, terminate, change, suspend, or discontinue any aspect of this Service, including:</p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Changing the availability of, restricting access to, or imposing limits on any or all features or services;</li>
              <li>Removing, adding, modifying, or otherwise changing any fees or charges arising out of the use of this Service;</li>
              <li>Removing, adding, modifying, or otherwise changing any content on this Service.</li>
            </ul>
          </section>

          {/* Indemnity */}
          <section id="indemnity">
            <h2 className="text-2xl font-bold mb-4">Indemnity</h2>
            <p className="text-muted-foreground mb-4">
              You agree to hold harmless, release, defend, and indemnify us and our officers, directors, employees, contractors, agents, affiliates, and subsidiaries from and against all claims, damages, obligations, losses, liabilities, costs, and expenses arising from:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>Your access and use of the Services;</li>
              <li>Your violation of any term or condition of these Terms, the right of any third party, or any other applicable law, rule, or regulation;</li>
              <li>Any other party&apos;s access and use of the Services with your assistance or using any device or account that you own or control;</li>
              <li>Any loss of funds from your self-custodial wallet, regardless of cause;</li>
              <li>Your failure to secure your device, your registered email address, or any private keys you export.</li>
            </ul>
          </section>

          {/* Disclaimers */}
          <section id="disclaimers">
            <h2 className="text-2xl font-bold mb-4">Disclaimers</h2>
            <p className="text-muted-foreground">
              THE SERVICES AND SOFTWARE ARE OFFERED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT ANY WARRANTIES. WE DISCLAIM ALL REPRESENTATIONS AND WARRANTIES, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING (BUT NOT LIMITED TO) THE WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE, TO THE FULLEST EXTENT PERMITTED BY LAW. YOU UNDERSTAND AND ACCEPT THAT USING THE SERVICES IS DONE AT YOUR OWN RISK. WE MAKE NO ASSURANCES OR WARRANTIES REGARDING THE TIMELINESS, CONTINUITY, ACCURACY, COMPLETENESS, OR SECURITY OF THE INFORMATION PROVIDED THROUGH THE SERVICES, NOR DO WE GUARANTEE THAT THE SERVICES WILL BE FREE OF BUGS, VIRUSES, OR OTHER HARMFUL COMPONENTS. WE DO NOT ENDORSE, GUARANTEE, OR ASSUME RESPONSIBILITY FOR ANY ADVERTISEMENTS, OFFERS, OR STATEMENTS MADE BY THIRD PARTIES CONCERNING THE SERVICES.
            </p>
          </section>

          {/* Limitation of Liability */}
          <section id="limitation-of-liability">
            <h2 className="text-2xl font-bold mb-4">Limitation of Liability</h2>
            <p className="text-muted-foreground">
              UNDER NO CIRCUMSTANCES SHALL WE OR ANY OF OUR OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, AGENTS, AFFILIATES, OR SUBSIDIARIES BE LIABLE TO YOU FOR ANY INDIRECT, PUNITIVE, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, INCLUDING (BUT NOT LIMITED TO) DAMAGES FOR LOSS OF PROFITS, GOODWILL, USE, DATA, OR OTHER INTANGIBLE PROPERTY, ARISING OUT OF OR RELATING TO ANY ACCESS OR USE OF THE SERVICES, NOR WILL WE BE RESPONSIBLE FOR ANY DAMAGE, LOSS, OR INJURY RESULTING FROM HACKING, TAMPERING, OR OTHER UNAUTHORIZED ACCESS OR USE OF THE SERVICES OR ANY WALLET ASSOCIATED THEREWITH. WE ASSUME NO LIABILITY OR RESPONSIBILITY FOR ANY: (A) ERRORS, MISTAKES, OR INACCURACIES OF CONTENT; (B) PERSONAL FINANCIAL LOSS, OF ANY NATURE WHATSOEVER, RESULTING FROM ANY ACCESS OR USE OF THE SERVICES; (C) UNAUTHORIZED ACCESS OR USE OF YOUR SELF-CUSTODIAL WALLET OR PRIVATE KEYS; (D) INTERRUPTION OR CESSATION OF FUNCTION RELATED TO THE SERVICES; (E) BUGS, VIRUSES, TROJAN HORSES, OR THE LIKE THAT MAY BE TRANSMITTED TO OR THROUGH THE SERVICES; (F) ERRORS OR OMISSIONS IN, OR LOSS OR DAMAGE INCURRED AS A RESULT OF THE USE OF, ANY CONTENT MADE AVAILABLE THROUGH THE SERVICES; (G) LOSS OF DIGITAL ASSETS DUE TO SMART CONTRACT VULNERABILITIES, BLOCKCHAIN NETWORK FAILURES, OR THIRD-PARTY SERVICE OUTAGES. UNDER NO CIRCUMSTANCES SHALL WE OR ANY OF OUR OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, AGENTS, AFFILIATES, OR SUBSIDIARIES BE LIABLE TO YOU FOR ANY CLAIMS, PROCEEDINGS, LIABILITIES, OBLIGATIONS, DAMAGES, LOSSES, OR COSTS IN AN AMOUNT EXCEEDING THE AMOUNT YOU PAID TO US IN EXCHANGE FOR ACCESS TO AND USE OF THE SERVICES, OR USD$100.00, WHICHEVER IS GREATER. THIS LIMITATION OF LIABILITY APPLIES REGARDLESS OF WHETHER THE ALLEGED LIABILITY IS BASED ON CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR ANY OTHER BASIS, AND EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH LIABILITY.
            </p>
          </section>

          {/* Dispute Resolution */}
          <section id="dispute-resolution">
            <h2 className="text-2xl font-bold mb-4">Dispute Resolution</h2>
            <p className="text-muted-foreground">
              We will use our best efforts to resolve any potential disputes through informal, good-faith negotiations. If a potential dispute arises, you must contact us by sending an email to support@usemoneymoves.xyz so that we can attempt to resolve it without resorting to formal dispute resolution. If we are not able to reach an informal resolution within sixty (60) days of your email, then you and we both agree to resolve the potential dispute according to the process set forth below. Any dispute, including (but not limited to) any dispute regarding arbitrability, arising out of or relating to the Services, this Agreement, or any other acts or omissions for which you may assert that we are liable (&quot;Dispute&quot;), shall be finally and exclusively resolved through arbitration in accordance with the Arbitration and Conciliation Act Cap. A18 LFN 2004. The arbitration shall be conducted in private before a single Arbiter. The arbitration will be held in Lagos, Nigeria unless you and we both agree to hold it elsewhere.
            </p>
          </section>

          {/* Class Action */}
          <section id="class-action-waiver">
            <h2 className="text-2xl font-bold mb-4">Class Action Waiver</h2>
            <p className="text-muted-foreground">
              You must file any and all claims against us individually, not as a member of a supposed class, group, or other representative proceeding. You agree to waive your right to participate in class arbitration or class action lawsuits.
            </p>
          </section>

          {/* Governing Law */}
          <section id="governing-law">
            <h2 className="text-2xl font-bold mb-4">Governing Law</h2>
            <p className="text-muted-foreground">
              You acknowledge and agree that this Agreement and any Dispute between you and us shall be governed by the laws of the Federation of Nigeria, without giving effect to any principles of conflict of laws. The Arbitration and Conciliation Act, Cap. A18 LFN 2004, shall apply to any arbitration conducted in accordance with this Agreement.
            </p>
          </section>

          {/* Miscellaneous */}
          <section id="miscellaneous">
            <h2 className="text-2xl font-bold mb-4">Miscellaneous</h2>

            <h3 className="text-lg font-semibold mt-6 mb-2">Severability</h3>
            <p className="text-muted-foreground mb-4">
              If a court of competent jurisdiction finds any term or provision of this Agreement to be invalid, unlawful, or unenforceable, such finding shall not affect any other term or provision of this Agreement and shall not render such term or provision invalid or unenforceable in any other jurisdiction.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Force Majeure</h3>
            <p className="text-muted-foreground mb-4">
              Money Moves is not liable for a breach or non-performance of the conditions of these Terms to the extent that circumstances beyond the control of Money Moves cause the breach, and for the period those circumstances persist. This includes but is not limited to blockchain network outages, smart contract failures, acts of God, government actions, and cyberattacks.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">No Agency, Partnership, or Joint Venture</h3>
            <p className="text-muted-foreground mb-4">
              No agency, partnership, or joint venture has been created between you and Money Moves as a result of this Agreement. You do not have any authority of any kind to bind the Company in any respect whatsoever.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Assignment</h3>
            <p className="text-muted-foreground mb-4">
              Without our prior written agreement, you are not permitted to assign or transfer any of your rights or duties under this Agreement. The Company may at any time freely assign or transfer its rights and duties under this Agreement.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Modification</h3>
            <p className="text-muted-foreground mb-4">
              We reserve the right to update the Services, the Agreement, and any specific agreement term at any time, for any reason, and in our sole discretion. All changes will be effective immediately when posted. If you don&apos;t agree with any modifications made to this Agreement, you must immediately stop using and accessing the Service.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Entire Agreement</h3>
            <p className="text-muted-foreground mb-4">
              The agreement set forth in these Terms represents the whole understanding between you and us regarding its subject. Any and all former or contemporaneous written and oral agreements, communications, and other understandings pertaining to the subject matter of the Terms are superseded by the terms of this Agreement.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Survival</h3>
            <p className="text-muted-foreground mb-4">
              All sections of these Terms which by their nature should survive the termination, expiration, or suspension of your Account or your use of the Services shall so survive, including without limitation: Self-Custodial Wallet &amp; Key Ownership; Prohibited Activities, AML &amp; Counter-Terrorism Financing; Transaction Monitoring &amp; Settlement Rights; No Refund &amp; No Recovery Policy; Indemnity; Disclaimers; Limitation of Liability; Dispute Resolution; Class Action Waiver; Governing Law; and this Survival clause.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">Notices</h3>
            <p className="text-muted-foreground mb-4">
              We may give you notices via in-app message, push notification, email to the address associated with your Account, or by posting on the Money Moves website. Notices are deemed received when sent or, in the case of website postings, when published. Legal notices to Money Moves must be sent in writing to <a href="mailto:support@usemoneymoves.xyz" className="text-primary hover:underline">support@usemoneymoves.xyz</a> and are not effective until acknowledged by us in writing.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-2">No Waiver</h3>
            <p className="text-muted-foreground mb-4">
              Our failure or delay in exercising or enforcing any right or provision under these Terms shall not operate as a waiver of that or any other right or provision. Any waiver, to be effective, must be in writing signed by an authorised representative of Money Moves.
            </p>
          </section>

          {/* Contact */}
          <section id="contact-information">
            <h2 className="text-2xl font-bold mb-4">Contact Information</h2>
            <p className="text-muted-foreground">
              For more information about Money Moves and any other inquiries about these Terms of Service, please contact <a href="mailto:support@usemoneymoves.xyz" className="text-primary hover:underline">support@usemoneymoves.xyz</a>.
            </p>
          </section>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t py-10" style={{ borderColor: T.rule, background: T.paperAlt }}>
        <div
          className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-5 text-[12px]"
          style={{ fontFamily: MONO, color: T.faint }}
        >
          <span>© {new Date().getFullYear()} Money Moves</span>
          <Link to="/" style={{ color: T.body }}>
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  )
}

/** One button, two stores, opened on click. */
function GetTheApp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[11.5px] font-semibold uppercase tracking-[0.12em] transition-opacity hover:opacity-90"
        style={{ fontFamily: MONO, background: T.deep, color: T.dark }}
      >
        Get the app
        <span className="text-[9px]" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[216px] overflow-hidden rounded-2xl"
          style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.7)' }}
        >
          {[
            { href: PLAY_STORE, icon: '/images/playstore singlr.png', top: 'Get it on', name: 'Google Play' },
            { href: APP_STORE, icon: '/images/applesingleblack.png', top: 'Download on the', name: 'App Store', invert: true },
          ].map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.04]"
              style={{ borderTop: s.invert ? `1px solid ${T.rule}` : undefined }}
            >
              <img
                src={s.icon}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
                style={s.invert ? { filter: 'invert(1)' } : undefined}
              />
              <span className="flex flex-col leading-none">
                <span className="mb-1 text-[8px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: T.faint }}>
                  {s.top}
                </span>
                <span className="text-[13px]" style={{ fontFamily: DISPLAY, fontWeight: 600, color: T.ink }}>
                  {s.name}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
