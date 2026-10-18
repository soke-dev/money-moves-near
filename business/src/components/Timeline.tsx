import { Check, X } from '@/components/icons'
import { cx } from '@/components/ui'

/** One thing that happened, or is still to happen, to a payment, invoice or refund. */
export type Step = { title: string; detail?: string; time?: string; state: 'done' | 'now' | 'wait' | 'failed' | 'todo' }

/** Steps down a line: filled when done, breathing while it's happening, dashed while it's still to come. */
export function Timeline({ items }: { items: Step[] }) {
  return (
    <ol>
      {items.map((s, i) => {
        const last = i === items.length - 1
        return (
          <li key={i} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last && (
              <span
                className={cx('absolute left-[11px] top-7 w-0 border-l', s.state === 'done' ? 'border-solid border-fg/35' : 'border-dashed border-[#CFCCC3]')}
                style={{ height: 'calc(100% - 26px)' }}
              />
            )}
            <span
              className={cx(
                'relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full',
                s.state === 'done' && 'bg-fg text-white',
                s.state === 'failed' && 'bg-red text-white',
                s.state === 'now' && 'border-2 border-fg bg-card',
                s.state === 'wait' && 'border-2 border-[#D98E1F] bg-card',
                s.state === 'todo' && 'border border-dashed border-[#BDB9AE] bg-card',
              )}
            >
              {s.state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
              {s.state === 'failed' && <X className="size-3.5" strokeWidth={3} />}
              {s.state === 'now' && <span className="anim-breathe size-2 rounded-full bg-fg" />}
              {s.state === 'wait' && <span className="size-2 rounded-full bg-[#D98E1F]" />}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={cx('text-[13.5px] font-medium', s.state === 'todo' ? 'text-dim' : s.state === 'failed' ? 'text-red' : 'text-fg')}>{s.title}</span>
                {s.time && <span className="tabular shrink-0 text-[12px] text-dim">{s.time}</span>}
              </div>
              {s.detail && <div className={cx('mt-0.5 break-words text-[12.5px] leading-relaxed', s.state === 'todo' ? 'text-dim' : 'text-muted')}>{s.detail}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
