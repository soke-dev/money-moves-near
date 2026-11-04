import React from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Zap,
  ShieldCheck,
  Menu,
  X,
  ArrowUpRight,
  Mail,
  Rocket,
  Monitor,
  HelpCircle,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion";

const usdcLogo = "/images/usdc-logo.png";
const usdtLogo = "/images/usdt.png";
const solLogo = "/images/solana.png";
const moveLogo = "/images/move-logo.png";
const baseLogo = "/images/base logo.png";
const bscLogo = "/images/bsc logo.png";

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [audience, setAudience] = React.useState<"personal" | "business">("personal");
  const [webModalOpen, setWebModalOpen] = React.useState(false);
  const [rates, setRates] = React.useState<Record<string, { ngn: number; change24h: number }> | null>(null);

  const closeWebModal = () => setWebModalOpen(false);

  const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app";
  const APP_STORE_URL = "https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053";

  React.useEffect(() => {
    const fetchRates = async () => {
      try {
        const res = await fetch("/api/rates");
        if (res.ok) {
          const data = await res.json();
          setRates(data);
        }
      } catch {
        // Rates fetch is best-effort; ignore network failures.
      }
    };
    fetchRates();
    const interval = setInterval(fetchRates, 600_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-primary-foreground">

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-[#0a0a0a] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* The lockup as it ships, on the ground it was drawn for. */}
            <img src="/images/logo-lockup.png" alt="Money Moves" className="h-6 sm:h-7 w-auto object-contain" />

            <div className="hidden md:block">
              <AudienceToggle audience={audience} onChange={setAudience} />
            </div>

            <div className="hidden md:flex items-center gap-6">
              <a href="mailto:support@usemoneymoves.xyz" className="flex items-center gap-2 text-white/70 text-sm font-medium rounded-full px-4 py-2 border border-white/15 hover:text-white hover:border-white/30 transition-colors"><Mail className="w-4 h-4" />Support<ArrowUpRight className="w-3.5 h-3.5" /></a>
              <a href="#faq" className="flex items-center gap-2 bg-primary text-[#0a0a0a] text-sm font-semibold rounded-full px-5 py-2.5 hover:brightness-110 transition-all">
                <HelpCircle className="w-4 h-4" /> FAQ
              </a>
            </div>

            <div className="md:hidden">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-white p-2">
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-[#0a0a0a] pt-20">
          <div className="flex flex-col items-center gap-6 p-8">
            <AudienceToggle
              audience={audience}
              onChange={(m) => { setAudience(m); setMobileMenuOpen(false); }}
            />
            <a href="mailto:support@usemoneymoves.xyz" className="flex items-center gap-2 text-white/80 text-lg font-medium rounded-full px-6 py-3 border border-white/15" onClick={() => setMobileMenuOpen(false)}><Mail className="w-5 h-5" />Support<ArrowUpRight className="w-4 h-4" /></a>
            <a href="#faq" className="flex items-center gap-2 bg-primary text-[#0a0a0a] font-semibold rounded-full px-6 py-3" onClick={() => setMobileMenuOpen(false)}>
              <HelpCircle className="w-4 h-4" /> FAQ
            </a>
          </div>
        </div>
      )}

      {audience === "personal" && (
        <>
      {/* Hero.
          A black panel runs down the right and meets the black bar above and
          the rates tape below, so the three read as one column with the
          headline set into the white beside it. The model stands across the
          join, which is what stops the photo looking pasted onto a page. */}
      <section className="relative bg-white pt-28 lg:pt-32 overflow-hidden">
        <div className="hidden lg:block absolute inset-y-0 right-0 w-[42%] bg-[#0a0a0a]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-[1.08fr_1fr] gap-10 lg:gap-6 items-end">
            {/* Left — text content */}
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="flex flex-col items-start text-left pb-16 lg:pb-24"
            >
              <motion.h1
                variants={fadeIn}
                className="text-[44px] sm:text-6xl xl:text-[76px] font-bold leading-[0.98] tracking-[-0.035em] mb-7 text-[#0a0a0a]"
              >
                Own Your Wallet,<br/>
                <span className="text-[#65a30d]">Spend Anywhere</span><br/>
                Across Africa.
              </motion.h1>

              <motion.p variants={fadeIn} className="text-lg lg:text-xl text-gray-500 mb-9 max-w-md leading-relaxed">
                A self-custodial finance app that lets you pay bills, send to any bank, and buy airtime straight from your crypto. No middlemen, no P2P, no stress.
              </motion.p>

              <motion.div variants={fadeIn} className="grid grid-cols-2 gap-2 sm:gap-3 mb-9 w-full sm:flex sm:items-center sm:w-auto">
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 sm:gap-3 bg-[#0a0a0a] text-white rounded-2xl h-[60px] px-3 sm:px-5 hover:bg-black transition-colors min-w-0 border border-white/10"
                >
                  <img src="/images/playstore singlr.png" alt="Google Play" className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 object-contain" />
                  <div className="flex flex-col items-start leading-none min-w-0">
                    <span className="text-[9px] text-white/70 uppercase tracking-wider mb-0.5">Get it on</span>
                    <span className="text-sm sm:text-base font-semibold truncate">Google Play</span>
                  </div>
                </a>
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 sm:gap-3 bg-[#0a0a0a] text-white rounded-2xl h-[60px] px-3 sm:px-5 hover:bg-black transition-colors min-w-0 border border-white/10"
                >
                  <img src="/images/applesingleblack.png" alt="App Store" className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 object-contain invert" />
                  <div className="flex flex-col items-start leading-none min-w-0">
                    <span className="text-[9px] text-white/70 uppercase tracking-wider mb-0.5">Download on the</span>
                    <span className="text-sm sm:text-base font-semibold truncate">App Store</span>
                  </div>
                </a>
              </motion.div>

              {/* Three facts, not badges. Each one is true of the build today. */}
              <motion.div
                variants={fadeIn}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[#0a0a0a]"
              >
                {[
                  ["4", "chains, one wallet"],
                  ["0", "gas, we sponsor it"],
                  ["<60s", "to your bank"],
                ].map(([big, small], i) => (
                  <div key={small} className="flex items-center gap-6">
                    {i > 0 && <span className="hidden sm:block h-8 w-px bg-gray-200" />}
                    <div>
                      <div className="text-xl font-bold leading-none">{big}</div>
                      <div className="text-[13px] text-gray-500 mt-1.5">{small}</div>
                    </div>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right — the app itself, drawn. A stock photograph of someone
                holding a phone dates the moment the UI changes; this is built
                from the product's own parts, so it moves when the product
                does. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex items-end justify-center lg:justify-end pb-16 lg:pb-24 pt-4"
            >
              <AppVisual />
            </motion.div>
          </div>
        </div>
      </section>

        </>
      )}

      {/* Business — one slab, one line, nothing to read. A page that says
          "coming soon" should take five seconds, not five paragraphs. */}
      {audience === "business" && (
        <section className="bg-white pt-32 lg:pt-36 pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="relative overflow-hidden rounded-[32px] bg-[#0a0a0a] px-8 py-20 sm:px-16 sm:py-28"
            >
              {/* One pool of brand light, off-centre, behind the type. */}
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full blur-3xl opacity-25"
                style={{ background: "radial-gradient(circle, #81FB02, transparent 65%)" }}
              />

              <div className="relative">
                <h1 className="text-5xl sm:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] text-white">
                  Coming
                  <br />
                  soon<span className="text-primary">.</span>
                </h1>

                <p className="mt-8 max-w-md text-lg text-white/50">
                  Same rails. Built for payroll, suppliers and settlement.
                </p>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Live Rates Ticker */}
      <div className="w-full bg-[#0a0a0a] border-y border-[#81FB02]/20 py-4 overflow-hidden flex whitespace-nowrap">
        <div className="animate-marquee flex items-center gap-12 px-6">
          {[...Array(3)].map((_, i) => (
            <React.Fragment key={i}>
              {([
                { symbol: "USDC", logo: usdcLogo },
                { symbol: "USDT", logo: usdtLogo },
                { symbol: "SOL", logo: solLogo },
                { symbol: "MOVE", logo: moveLogo },
              ] as const).map((t) => {
                const r = rates?.[t.symbol];
                const ngn = r ? r.ngn.toLocaleString("en-NG") : "...";
                const change = r ? r.change24h : 0;
                const isUp = change >= 0;
                return (
                  <div key={t.symbol} className="flex items-center gap-2">
                    <img src={t.logo} alt={t.symbol} className="w-6 h-6 rounded-full" />
                    <span className="font-semibold text-muted-foreground">{t.symbol}</span>
                    <span className="font-bold text-white">₦{ngn}</span>
                    <span className={`text-sm flex items-center ${isUp ? "text-primary" : "text-red-400"}`}>
                      <Zap className="w-3 h-3 ml-1" />
                      {isUp ? "+" : ""}{change.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {audience === "personal" && (
        <>
      {/* Features Section */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 tracking-tight">Everything You Need, One App</h2>
            <p className="text-lg text-muted-foreground">Hold your own keys, spend across chains, and handle everyday payments without ever leaving the app.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              title="Multi-Chain Deposits"
              description="Fund your wallet with USDC, USDT, SOL, or MOVE across Movement, Solana, Base, and Binance Chain. One wallet, multiple chains."
              visual={
                <div className="flex -space-x-3 mt-4">
                  <img src={usdcLogo} className="w-12 h-12 rounded-full border-4 border-card z-40" />
                  <img src={usdtLogo} className="w-12 h-12 rounded-full border-4 border-card z-30" />
                  <img src={solLogo} className="w-12 h-12 rounded-full border-4 border-card z-20 bg-black" />
                  <img src={moveLogo} className="w-12 h-12 rounded-full border-4 border-card z-10" />
                </div>
              }
            />
            <FeatureCard
              title="Instant Bank Cashout"
              description="Convert crypto to naira and land it in any Nigerian bank account in under 30 seconds. No delays, no third party."
              icon={<PngIcon src="/images/bank.png" />}
            />
            <FeatureCard
              title="Airtime & Data Top-Up"
              description="Recharge MTN, Airtel, Glo, or 9mobile directly from your crypto balance. Fast, cheap, and always available."
              icon={<PngIcon src="/images/telephone-call.png" />}
            />
            <FeatureCard
              title="Pay Bills Instantly"
              description="Settle electricity, DStv, GOtv, and StarTimes from your wallet. No bank app needed."
              icon={<PngIcon src="/images/flash.png" />}
            />
            <FeatureCard
              title="Send by @Username"
              description="Forget long wallet addresses. Send crypto to anyone on Money Moves using just their @username."
              icon={<PngIcon src="/images/user.png" />}
            />
            <FeatureCard
              title="Self-Custodial Security"
              description="Your private keys never leave your device. Export, back up, and recover your wallet anytime. You're always in control."
              icon={<PngIcon src="/images/lock.png" />}
            />
            <FeatureCard
              title="Crypto Savings Vault"
              description="Set aside crypto in a secure onchain vault. Flexible or fixed, your funds stay safe and accessible on your terms."
              icon={<PngIcon src="/images/piggy-bank.png" />}
            />
            <FeatureCard
              title="Loyalty & Referrals"
              description="Share your link and earn crypto when friends join and transact. Climb the leaderboard and unlock bonus rewards as you go."
              icon={<PngIcon src="/images/people.png" />}
            />
            <FeatureCard
              title="Gasless & Onchain"
              description="Every transaction is settled onchain with zero gas fees. We sponsor all network costs so you never pay for gas."
              icon={<PngIcon src="/images/naira.png" />}
            />
          </div>
        </div>
      </section>

      {/* Supported Chains */}
      <section className="py-24 bg-card/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold mb-12 text-muted-foreground uppercase tracking-widest">Multi-Chain. One App.</h2>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-80 hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <img src={moveLogo} alt="Movement" className="h-12 w-12 grayscale hover:grayscale-0 transition-all" />
              <span className="text-2xl font-bold font-mono">Movement</span>
            </div>
            <div className="flex items-center gap-3">
              <img src={solLogo} alt="Solana" className="h-12 w-12 grayscale hover:grayscale-0 transition-all" />
              <span className="text-2xl font-bold font-mono">Solana</span>
            </div>
            <div className="flex items-center gap-3">
              <img src={baseLogo} alt="Base" className="h-12 w-12 grayscale hover:grayscale-0 transition-all" />
              <span className="text-2xl font-bold font-mono">Base</span>
            </div>
            <div className="flex items-center gap-3">
              <img src={bscLogo} alt="Binance Chain" className="h-12 w-12 grayscale hover:grayscale-0 transition-all" />
              <span className="text-2xl font-bold font-mono">Binance Chain</span>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold mb-16 tracking-tight text-center">Trusted by <span className="text-primary">Money Movers</span> across Nigeria</h2>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              "I used to dread P2P, the waiting, the scammers. Now I just hit cashout and money lands in my GTBank in seconds. Game changer.",
              "The fact that I hold my own keys and can still pay for my DStv directly? That's the dream. Self-custody and real-world spending in one app.",
              "Sent USDC to my guy using just @tunde_dev. No wallet address, no copy-paste panic. This is how crypto should work.",
              "I keep my freelance earnings in the savings vault and cash out when the rate is right. Beautiful app, actually built for Nigerians.",
              "Bought airtime with MOVE tokens and paid my electricity bill with USDC, all in one morning. The future is already here.",
              "I exported my wallet backup on day one. Knowing I truly own my keys gives me peace of mind. Support team is also A1."
            ].map((text, i) => (
              <div key={i} className="bg-card p-8 rounded-3xl border border-border/50 hover:border-primary/50 transition-colors">
                <div className="flex text-primary mb-4">
                  {[...Array(5)].map((_, j) => <span key={j}>★</span>)}
                </div>
                <p className="text-lg leading-relaxed">"{text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-card/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-5xl font-bold mb-12 tracking-tight text-center">Frequently Asked Questions</h2>

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">What is Money Moves?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Money Moves is a self-custodial crypto wallet built for Africans. It lets you hold your own private keys while spending crypto on everyday things like bank transfers, airtime, data, electricity, and TV subscriptions without going through exchanges or P2P.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">What does "self-custodial" mean?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                It means you own your private keys, not us. Your wallet is created on your device, and only you can access your funds. You can export and back up your recovery phrase at any time. We never have access to your crypto.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">Which tokens and chains are supported?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                We currently support USDC, USDT, SOL, and MOVE tokens across Solana, Base, and Movement networks. Your wallet generates addresses for each chain automatically. Just deposit and start spending.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">How fast are bank cashouts?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Typically under 30 seconds. Select your bank, enter the amount, and the naira equivalent lands in your account almost instantly. We support all major Nigerian banks.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-5" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">Can I send crypto to someone without their wallet address?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Yes! Every Money Moves user has a unique @username. Just search their username and send. No long addresses, no mistakes. It's as simple as sending a text.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-6" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">What bills can I pay?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Airtime and data for MTN, Airtel, Glo, and 9mobile. Electricity (prepaid and postpaid). TV subscriptions including DStv, GOtv, and StarTimes. All paid directly from your crypto balance.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-7" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">Is there a minimum deposit?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                No minimum. Deposit any amount you like. Just keep in mind that each blockchain charges a small network fee (gas), so ensure you have enough to cover that.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-8" className="border-border">
              <AccordionTrigger className="text-lg hover:text-primary">How do referrals and the leaderboard work?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Share your referral code or referral link. When someone signs up and makes their first transaction, you both earn crypto rewards. Top referrers each month climb the leaderboard and unlock bonus prizes.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 relative overflow-hidden bg-[#0a0a0a]">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-primary/5" />

        <div className="max-w-4xl mx-auto px-4 relative z-10 text-center">
          <h2 className="text-4xl md:text-6xl font-bold mb-10 tracking-tight">Your Crypto. Your Keys.<br/>Your Everyday Spending.</h2>

          <div className="flex flex-wrap gap-2 sm:gap-3 items-center justify-center">
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 sm:gap-3 bg-white text-[#0a0a0a] rounded-2xl h-[60px] px-3 sm:px-5 hover:bg-white/90 transition-colors border border-white/20 min-w-0"
            >
              <img src="/images/playstore singlr.png" alt="Google Play" className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 object-contain" />
              <div className="flex flex-col items-start leading-none min-w-0">
                <span className="text-[9px] text-[#0a0a0a]/60 uppercase tracking-wider mb-0.5">Get it on</span>
                <span className="text-sm sm:text-base font-semibold truncate">Google Play</span>
              </div>
            </a>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 sm:gap-3 bg-white text-[#0a0a0a] rounded-2xl h-[60px] px-3 sm:px-5 hover:bg-white/90 transition-colors border border-white/20 min-w-0"
            >
              <img src="/images/applesingleblack.png" alt="App Store" className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 object-contain" />
              <div className="flex flex-col items-start leading-none min-w-0">
                <span className="text-[9px] text-[#0a0a0a]/60 uppercase tracking-wider mb-0.5">Download on the</span>
                <span className="text-sm sm:text-base font-semibold truncate">App Store</span>
              </div>
            </a>
          </div>
        </div>
      </section>

        </>
      )}

      {/* Footer — columns with their headings ending in a colon, the way a
          directory is set out, then the small print behind a rule. No
          addresses: we do not run a counter anyone visits. */}
      <footer className="bg-[#0a0a0a] pt-20 pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <img src="/images/logo-lockup.png" alt="Money Moves" className="h-8 w-auto object-contain mb-16" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-12">
            <div>
              <h4 className="text-white font-bold text-[17px] mb-5">Company:</h4>
              <ul className="space-y-3.5">
                <li><a href="#faq" className="text-white/70 hover:text-primary transition-colors">FAQ</a></li>
                <li><Link to="/terms" className="text-white/70 hover:text-primary transition-colors">Terms of Service</Link></li>
                <li><Link to="/terms" className="text-white/70 hover:text-primary transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold text-[17px] mb-5">Get the app:</h4>
              <ul className="space-y-3.5">
                <li>
                  <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-primary transition-colors">
                    Google Play
                  </a>
                </li>
                <li>
                  <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-primary transition-colors">
                    App Store
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold text-[17px] mb-5">Socials:</h4>
              <div className="flex items-center gap-4">
                <a
                  href="https://x.com/usemoneymoves"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="X"
                  className="text-white hover:text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] fill-current"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a
                  href="https://discord.com/invite/NTytthPS3d"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Discord"
                  className="text-white hover:text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] fill-current"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                </a>
              </div>
            </div>

            <div>
              <h4 className="text-white font-bold text-[17px] mb-5">Contact us:</h4>
              <a href="mailto:support@usemoneymoves.xyz" className="text-white/70 hover:text-primary transition-colors break-all">
                support@usemoneymoves.xyz
              </a>
            </div>
          </div>

          <div className="mt-16">
            <h4 className="text-white font-bold text-[17px] mb-4">Legal:</h4>
            <Link
              to="/terms"
              className="text-white/80 hover:text-primary text-xs font-semibold uppercase tracking-wider underline underline-offset-4 transition-colors"
            >
              Terms of Service
            </Link>
          </div>

          <div className="mt-14 pt-10 border-t border-white/10 space-y-4 text-white/40 text-sm leading-relaxed">
            <p>
              Money Moves is a self-custodial wallet. Your keys are generated against your account and split
              so that no single party, us included, ever holds a whole one. We do not hold your crypto and we
              cannot move it.
            </p>
            <p>
              Naira payments and payouts are processed by our licensed payment partners. Identity verification
              is carried out by our verification partner, who holds the documents you submit.
            </p>
          </div>

          <div className="mt-12 text-center text-white/40 text-sm">
            <p>&copy; {new Date().getFullYear()} Money Moves. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Web Version Modal */}
      {webModalOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in-overlay"
          onClick={closeWebModal}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header banner */}
            <div className="relative bg-gradient-to-br from-[#81FB02] via-[#b6e035] to-[#9ac73a] px-6 pt-8 pb-10 text-center">
              <button
                onClick={closeWebModal}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-[#0a0a0a]" />
              </button>

              <div className="inline-flex items-center gap-2 bg-[#0a0a0a] text-[#81FB02] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-4">
                <Monitor className="w-3.5 h-3.5" />
                Web Version
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-[#0a0a0a] tracking-tight leading-tight">
                Ready to try Money Moves?
              </h3>
              <p className="text-sm text-[#0a0a0a]/70 mt-2 font-medium">
                Experience the full power of self-custodial crypto spending in your browser.
              </p>
            </div>

            {/* Features */}
            <div className="px-6 py-6 space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[#0a0a0a] text-[#81FB02] flex items-center justify-center font-bold">
                  ✨
                </div>
                <div className="flex-1 pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-[#65a30d]" />
                    <h4 className="font-bold text-[#0a0a0a]">Full-Featured Experience</h4>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Access all Money Moves features: multi-chain deposits, instant bank cashouts, bill payments, and more.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[#0a0a0a] text-[#81FB02] flex items-center justify-center font-bold">
                  🔒
                </div>
                <div className="flex-1 pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="w-4 h-4 text-[#65a30d]" />
                    <h4 className="font-bold text-[#0a0a0a]">Self-Custodial Security</h4>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Your private keys are generated and stored locally in your browser. You maintain full control of your funds.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[#0a0a0a] text-[#81FB02] flex items-center justify-center font-bold">
                  🚀
                </div>
                <div className="flex-1 pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Rocket className="w-4 h-4 text-[#65a30d]" />
                    <h4 className="font-bold text-[#0a0a0a]">Instant Access</h4>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    No downloads needed. Create your wallet and start spending crypto on real-world services right away.
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-6 pb-6 space-y-3">
              <a
                href="https://web.usemoneymoves.xyz/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeWebModal}
                className="w-full flex items-center justify-center gap-2.5 bg-[#81FB02] text-[#0a0a0a] rounded-2xl h-[56px] px-6 hover:bg-[#b6e035] transition-colors font-semibold"
              >
                <Zap className="w-5 h-5" />
                Launch Web App
                <ArrowUpRight className="w-4 h-4" />
              </a>

              <p className="text-[11px] text-gray-400 text-center leading-relaxed pt-1">
                By using Money Moves you agree to our{" "}
                <Link to="/terms" className="underline hover:text-gray-600" onClick={closeWebModal}>
                  Terms of Service & Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Marquee Animation CSS */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        @keyframes fade-in-overlay {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in-overlay {
          animation: fade-in-overlay 0.2s ease-out;
        }
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-modal-pop {
          animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
      `}} />
    </div>
  );
}

/**
 * The hero artwork: the app, in vector.
 *
 * Built out of the parts the product is made of - a balance, two actions, the
 * quick row, a list of assets - so it reads as the thing itself rather than a
 * picture of it, and it cannot date the way a screenshot does. The two chips
 * either side are the moments people actually wait on: money arriving, and
 * money reaching a bank.
 */
function AppVisual() {
  const mask = (src: string, color = "#81FB02") => ({
    backgroundColor: color,
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskRepeat: "no-repeat" as const,
    maskRepeat: "no-repeat" as const,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  });

  const actions = [
    { icon: "/images/plus.png", label: "Deposit", lit: false },
    { icon: "/images/billing.png", label: "Pay bills", lit: false },
    { icon: "/images/qr-code.png", label: "Scan & pay", lit: false },
    { icon: "/images/send.png", label: "Send money", lit: true },
  ];

  const feed = [
    { who: "From @ovie", meta: "Movement · Sep 12", amt: "+0.1508 USDC", in: true },
    { who: "From @ada", meta: "Base · Sep 11", amt: "+0.1509 USDC", in: true },
    { who: "Withdrew USDC", meta: "Movement · Sep 4", amt: "−15 USDC", in: false },
    { who: "From @chidi", meta: "Solana · Sep 4", amt: "+15.1388 USDC", in: true },
  ];

  return (
    <div className="relative w-[292px] sm:w-[330px]">
      {/* Orbits struck from the phone, rather than a decorative blob. */}
      <svg
        viewBox="0 0 520 520"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 opacity-[0.22]"
        aria-hidden
      >
        <circle cx="260" cy="260" r="150" fill="none" stroke="#81FB02" strokeWidth="1" />
        <circle cx="260" cy="260" r="205" fill="none" stroke="#81FB02" strokeWidth="1" strokeDasharray="3 7" />
        <circle cx="260" cy="260" r="255" fill="none" stroke="#81FB02" strokeWidth="1" strokeOpacity="0.5" />
      </svg>

      <div className="relative z-10 rounded-[42px] border border-white/[0.12] bg-[#101010] p-2.5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="relative overflow-hidden rounded-[34px] bg-[#0a0a0a] pb-3 pt-3">
          <div className="mx-auto mb-3 h-[20px] w-[76px] rounded-full bg-black" />

          {/* Greeting, then the two things that live in the top corner. */}
          <div className="flex items-center justify-between px-4">
            <span className="text-[13px] font-semibold text-white">Hello, soke</span>
            <div className="flex items-center gap-2.5">
              <div className="h-[13px] w-[13px]" style={mask("/images/bell.png", "#ffffff")} />
              <div className="h-[13px] w-[13px]" style={mask("/images/customer-service.png", "#ffffff")} />
            </div>
          </div>

          {/* Balance card */}
          <div className="mx-3 mt-3 rounded-2xl bg-white/[0.04] px-4 pb-4 pt-3.5 text-center">
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Total balance
            </div>
            <div className="mt-1.5 flex items-baseline justify-center gap-0.5 text-white">
              <span className="text-[15px] font-semibold">&#8358;</span>
              <span className="text-[28px] font-bold leading-none tracking-tight">106,014</span>
              <span className="text-[14px] font-semibold text-white/45">.75</span>
            </div>

            <div className="mt-4 flex justify-between px-1">
              {actions.map((a) => (
                <div key={a.label} className="flex w-[56px] flex-col items-center gap-1.5">
                  <div
                    className={`flex h-[38px] w-[38px] items-center justify-center rounded-full ${
                      a.lit ? "bg-primary" : "bg-white/[0.07]"
                    }`}
                  >
                    <div
                      className="h-[15px] w-[15px]"
                      style={mask(a.icon, a.lit ? "#0a0a0a" : "#ffffff")}
                    />
                  </div>
                  <span className="text-[8.5px] leading-tight text-white/55">{a.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feed */}
          <div className="mt-4 flex items-center justify-between px-4">
            <div className="flex items-end gap-3">
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white">
                Transactions
              </span>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">
                Assets
              </span>
            </div>
            <span className="text-[9px] font-semibold text-primary">View more &rsaquo;</span>
          </div>

          <div className="mt-1 px-4">
            {feed.map((t) => (
              <div key={t.who + t.meta} className="flex items-center gap-2.5 py-2.5">
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary/15">
                  <div
                    className="h-[12px] w-[12px]"
                    style={mask(t.in ? "/images/usdc-black.png" : "/images/send.png")}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold text-white">{t.who}</div>
                  <div className="text-[8.5px] text-white/35">{t.meta}</div>
                </div>
                <div className={`text-[10.5px] font-semibold ${t.in ? "text-primary" : "text-white/80"}`}>
                  {t.amt}
                </div>
              </div>
            ))}
          </div>

          {/* The bar floats over the list, the way it does in the app. */}
          <div className="mx-auto mt-2 flex w-[184px] items-center justify-between rounded-full bg-[#1b1b1b] px-3 py-1.5">
            {[
              { icon: "/images/user.png", label: "Account", on: false },
              { icon: "/images/home.png", label: "Home", on: true },
              { icon: "/images/transaction.png", label: "Finance", on: false },
            ].map((t) => (
              <div
                key={t.label}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${t.on ? "bg-black" : ""}`}
              >
                <div
                  className="h-[12px] w-[12px]"
                  style={mask(t.icon, t.on ? "#81FB02" : "#6b6b6b")}
                />
                <span className={`text-[8px] ${t.on ? "text-white" : "text-white/40"}`}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The two moments people wait on, drifting either side. */}
      <div className="mm-float-a absolute -left-6 top-[128px] z-20 hidden sm:block">
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#141414] px-3.5 py-2.5 shadow-xl">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold text-primary">
            +
          </span>
          <div className="leading-tight">
            <div className="text-[11.5px] font-semibold text-white">8.50 USDC</div>
            <div className="text-[9.5px] text-white/40">from @ovie</div>
          </div>
        </div>
      </div>

      <div className="mm-float-b absolute -right-5 bottom-[104px] z-20 hidden sm:block">
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#141414] px-3.5 py-2.5 shadow-xl">
          <div className="h-5 w-5" style={mask("/images/bank.png")} />
          <div className="leading-tight">
            <div className="text-[11.5px] font-semibold text-white">&#8358;12,450 sent</div>
            <div className="text-[9.5px] text-white/40">GTBank &middot; 41s</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Personal / Business, as one switch rather than two buttons.
 *
 * The lit half is a single element that slides, so the eye follows one object
 * across instead of watching two swap colour. Both halves share a column so
 * the travel is exactly half the track no matter how long the words are.
 */
function AudienceToggle({
  audience,
  onChange,
}: {
  audience: "personal" | "business";
  onChange: (a: "personal" | "business") => void;
}) {
  const options = ["personal", "business"] as const;
  return (
    <div
      className="relative grid grid-cols-2 p-1 rounded-full bg-white/[0.06]"
      style={{ boxShadow: "0 0 0 1px rgba(129,251,2,0.35)" }}
      role="tablist"
    >
      {/* The travelling half. */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-full bg-primary"
        style={{
          width: "calc(50% - 0.25rem)",
          transform: audience === "business" ? "translateX(100%)" : "translateX(0)",
          transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      {options.map((m) => {
        const on = audience === m;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(m)}
            className={`relative z-10 h-9 px-6 rounded-full text-sm font-semibold capitalize whitespace-nowrap transition-colors duration-200 ${
              on ? "text-[#0a0a0a]" : "text-white/60 hover:text-white"
            }`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The app's PNG glyphs are solid black artwork, the same files the phone app
 * tints at runtime. A mask paints them in brand green so they read on a dark
 * card instead of disappearing into it.
 */
function PngIcon({ src }: { src: string }) {
  return (
    <div
      className="w-10 h-10"
      style={{
        backgroundColor: "#81FB02",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

function FeatureCard({ title, description, icon, visual }: { title: string, description: string, icon?: React.ReactNode, visual?: React.ReactNode }) {
  return (
    <div className="bg-card border border-border p-8 rounded-3xl hover:bg-card/80 transition-all hover:border-primary/50 group">
      <div className="mb-6 h-16 flex items-center">
        {icon}
        {visual}
      </div>
      <h3 className="text-xl font-bold mb-3 text-white group-hover:text-primary transition-colors">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
