/**
 * Google's own sign-in button.
 *
 * Google draws it (their rules: the real button, in their colours), and hands
 * back an ID token we pass to the API, which checks it with Google. No Google
 * password or token is ever kept here.
 */
import { useEffect, useRef } from 'react'
import { GOOGLE_CLIENT_ID } from '@/lib/api'

interface GoogleId {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; itp_support?: boolean }) => void
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let loading: Promise<void> | null = null
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('google'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export function GoogleSignIn({ text, onCredential, onError }: { text: 'signin_with' | 'signup_with' | 'continue_with'; onCredential: (idToken: string) => void; onError?: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  // The latest handlers, without re-drawing Google's button every render.
  const handlers = useRef({ onCredential, onError })
  handlers.current = { onCredential, onError }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let alive = true
    loadGoogle()
      .then(() => {
        const el = box.current
        if (!alive || !el || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID!,
          callback: (r) => handlers.current.onCredential(r.credential),
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
        })
        window.google.accounts.id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text, shape: 'rectangular', logo_alignment: 'center', width: Math.min(400, el.offsetWidth || 360) })
      })
      .catch(() => handlers.current.onError?.("Google sign-in couldn't load. Use your email instead, or try again."))
    return () => {
      alive = false
    }
  }, [text])

  if (!GOOGLE_CLIENT_ID) return null
  return <div ref={box} className="flex min-h-11 w-full justify-center" />
}
