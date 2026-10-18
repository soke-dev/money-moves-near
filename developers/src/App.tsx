import { Link, Navigate, useLocation } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Page, P } from '@/components/docs'
import { PAGES } from '@/pages'

function NotFound() {
  return (
    <Page title="Page not found" lead="We couldn't find that page. The URL may be incorrect, or the page may have moved.">
      <P>
        Search the docs or start with the <Link to="/introduction">introduction</Link>.
      </P>
    </Page>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return <Navigate to="/introduction" replace />
  const Current = PAGES[path] ?? NotFound
  return (
    <Layout>
      <Current key={path} />
    </Layout>
  )
}
