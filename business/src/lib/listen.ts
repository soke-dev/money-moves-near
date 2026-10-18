/**
 * Listening to a server-sent event stream. Read with fetch rather than
 * EventSource, so a cookie or a bearer token goes with it; after a drop it
 * waits a little longer each time and connects again. Signed out, it stops.
 */
export function listen(url: string, init: RequestInit, onEvent: (event: { type: string; [k: string]: unknown }) => void, onUp?: (up: boolean) => void) {
  let stopped = false
  let ctrl: AbortController | null = null
  let wait = 1000
  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController()
      try {
        const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { ...(init.headers as Record<string, string> | undefined), accept: 'text/event-stream' } })
        if (r.status === 401 || r.status === 403) return
        if (!r.ok || !r.body) throw new Error(String(r.status))
        onUp?.(true)
        wait = 1000
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let cut: number
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, cut)
            buf = buf.slice(cut + 2)
            const data = chunk
              .split('\n')
              .filter((l) => l.startsWith('data: '))
              .map((l) => l.slice(6))
              .join('\n')
            if (!data) continue
            try {
              onEvent(JSON.parse(data))
            } catch {
              /* not ours */
            }
          }
        }
      } catch {
        if (stopped) return
      }
      onUp?.(false)
      if (stopped) return
      await new Promise((r) => setTimeout(r, wait))
      wait = Math.min(wait * 2, 15_000)
    }
  }
  void run()
  return () => {
    stopped = true
    ctrl?.abort()
  }
}
