import { Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import styles from './Navbar.module.css'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          <img src="/images/logo.png" alt="Money Moves" className={styles.logoImg} />
          <span className={styles.logoText}>Money Moves</span>
        </Link>

        <div className={styles.links}>
          <Link to="/" className={pathname === '/' ? styles.active : ''}>Home</Link>
          <Link to="/terms" className={pathname === '/terms' ? styles.active : ''}>Terms</Link>
        </div>

        <a href="/images/barcode-moneymoves.png" target="_blank" className={styles.downloadBtn}>
          Download
          <img src="/images/barcode-moneymoves.png" alt="QR" className={styles.qrMini} />
        </a>

        <button className={styles.burger} onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
        </button>
      </div>

      {menuOpen && (
        <div className={styles.mobileMenu}>
          <Link to="/" onClick={() => setMenuOpen(false)}>Home</Link>
          <Link to="/terms" onClick={() => setMenuOpen(false)}>Terms</Link>
          <div className={styles.mobileStores}>
            <a href="https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app" target="_blank" rel="noopener noreferrer"><img src="/images/google-play.svg" alt="Google Play" /></a>
            <a href="https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053" target="_blank" rel="noopener noreferrer"><img src="/images/app-store.svg" alt="App Store" /></a>
          </div>
        </div>
      )}
    </nav>
  )
}
