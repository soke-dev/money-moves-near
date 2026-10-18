import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import Analytics from './pages/Analytics'
import Terms from './pages/Terms'
import AdminLogin from './pages/admin/Login'
import AdminDashboard from './pages/admin/Dashboard'

// NOTE: The cross-chain deposit page (/intents-deposit) is temporarily
// excluded from the build. Its swap-widget dependency tree (Wormhole,
// hot-labs omni-sdk, algosdk) pulls in Node-only modules that don't bundle
// for the browser without a full polyfill/resolve setup. Re-enable once that
// is configured (vite-plugin-node-polyfills + algosdk resolution).
// import IntentsDeposit from './pages/IntentsDeposit'

/**
 * Start every page at the top.
 *
 * Changing route leaves the scroll position exactly where it was, and the
 * links to the Terms sit in the footer of a very long landing page - so
 * arriving there dropped you the same distance down, which read as the Terms
 * opening halfway through rather than at the beginning.
 *
 * A hash is left alone: that is a request for a particular section, and
 * jumping to the top would be overriding the thing the link asked for.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) return
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/terms" element={<Terms />} />
        {/* <Route path="/intents-deposit" element={<IntentsDeposit />} /> */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
      </Routes>
    </>
  )
}
