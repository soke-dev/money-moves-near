/**
 * Test mode, said plainly where it matters: whether you are in it, and a short
 * note inside a flow that would move real money in live mode.
 */
import { FlaskConical } from '@/components/icons'
import { useSession } from '@/state/session'

export function useTestMode() {
  const { mode, business, setMode } = useSession()
  return {
    test: mode === 'test',
    verified: business?.verify === 'verified',
    goLive: () => setMode('live'),
  }
}

/** A short note, for inside a modal or beside a button that does something simulated. */
export function TestModeHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#EBD3A6] bg-[#FDF6E7] p-3 text-[13px] leading-relaxed text-[#6E440A]">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
