import { Link } from 'react-router-dom'
import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      {/* CTA */}
      <div className={styles.cta}>
        <h2 className={styles.ctaTitle}>
          Erase crypto complexity<br />with <span className={styles.accent}>Money Moves</span>
        </h2>
        <div className={styles.storeRow}>
          <a href="https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app" target="_blank" rel="noopener noreferrer"><img src="/images/google-play.svg" alt="Google Play" className={styles.storeImg} /></a>
          <a href="https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053" target="_blank" rel="noopener noreferrer"><img src="/images/app-store.svg" alt="App Store" className={styles.storeImg} /></a>
        </div>
      </div>

      {/* Bottom */}
      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          <div className={styles.brand}>
            <img src="/images/logo.png" alt="Money Moves" className={styles.footerLogo} />
            <span className={styles.brandName}>Money Moves</span>
            <p className={styles.address}>Lagos, Nigeria.</p>
          </div>

          <div className={styles.col}>
            <h4>Company</h4>
            <Link to="/terms">Terms of Use &amp; Policy</Link>
          </div>

          <div className={styles.col}>
            <h4>Talk to Us</h4>
            <a href="mailto:support@usemoneymoves.xyz">support@usemoneymoves.xyz</a>
            <div className={styles.socials}>
              <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter/X">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5"/></svg>
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.53a6.25 6.25 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.58a8.24 8.24 0 004.82 1.56V6.69h-1.06z"/></svg>
              </a>
            </div>
          </div>
        </div>
        <div className={styles.copy}>
          &copy; All rights reserved {new Date().getFullYear()}, Money Moves
        </div>
      </div>
    </footer>
  )
}
