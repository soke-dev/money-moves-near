/**
 * The pieces every docs page is made of: the title with its Copy page menu,
 * headings that feed "On this page", code with tabs and copy, callouts, steps,
 * field tables and endpoints. Every colour comes from the theme tokens.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRightIcon, ArrowUpRightIcon, AsteriskIcon, CaretDownIcon, CaretRightIcon, CheckIcon, CopyIcon, InfoIcon, LightbulbIcon, MarkdownLogoIcon, OpenAiLogoIcon, WarningIcon } from '@phosphor-icons/react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ─── Copy page ────────────────────────────────────────────────────── */

/** The page as Markdown, read from what's on screen: headings, prose, lists, tables and code. */
function pageMarkdown(): string {
  const article = document.querySelector('article')
  if (!article) return ''
  const abs = (href: string) => {
    try {
      return new URL(href, window.location.href).toString()
    } catch {
      return href
    }
  }
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\s+/g, ' ')
    if (!(n instanceof HTMLElement) || n.dataset.skip !== undefined) return ''
    const inner = [...n.childNodes].map(inline).join('')
    if (n.tagName === 'CODE') return `\`${n.textContent}\``
    if (n.tagName === 'A') return `[${inner.trim()}](${abs(n.getAttribute('href') ?? '')})`
    if (n.tagName === 'STRONG' || n.tagName === 'B') return `**${inner.trim()}**`
    if (n.tagName === 'BR') return '\n'
    if (n.tagName === 'P') return `${inner.trim()}\n\n`
    return inner
  }
  const out: string[] = []
  const block = (el: Element) => {
    if (!(el instanceof HTMLElement) || el.dataset.skip !== undefined) return
    const t = el.tagName
    if (t === 'H1') out.push(`# ${el.textContent?.trim()}`)
    else if (t === 'H2') out.push(`## ${el.textContent?.replace(/#$/, '').trim()}`)
    else if (t === 'H3') out.push(`### ${el.textContent?.trim()}`)
    else if (t === 'P' || t === 'BLOCKQUOTE') out.push(`${t === 'BLOCKQUOTE' ? '> ' : ''}${inline(el).trim()}`)
    else if (t === 'PRE') out.push(`\`\`\`${el.dataset.lang ?? ''}\n${el.textContent?.replace(/\n$/, '')}\n\`\`\``)
    else if (t === 'UL' || t === 'OL') out.push([...el.children].map((li, i) => `${t === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`).join('\n'))
    else if (t === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inline(c).trim().replace(/\|/g, '\\|')))
      if (rows.length) out.push([`| ${rows[0]!.join(' | ')} |`, `| ${rows[0]!.map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n'))
    } else if (el.dataset.md === 'text') out.push(inline(el).trim())
    else [...el.children].forEach(block)
  }
  ;[...article.children].forEach(block)
  return `${out.filter(Boolean).join('\n\n')}\n\nSource: ${window.location.href}\n`
}

function CopyPage() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const copy = () => {
    void navigator.clipboard?.writeText(pageMarkdown()).catch(() => undefined)
    setDone(true)
    setOpen(false)
    setTimeout(() => setDone(false), 1500)
  }
  const view = () => {
    const url = URL.createObjectURL(new Blob([pageMarkdown()], { type: 'text/plain;charset=utf-8' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    setOpen(false)
  }
  const ask = (base: string) => {
    const prompt = `I'm reading this page of the Money Moves Business developer docs: ${window.location.href}\nHelp me understand it and answer my questions about it.\n\n${pageMarkdown().slice(0, 6000)}`
    window.open(`${base}${encodeURIComponent(prompt)}`, '_blank', 'noopener')
    setOpen(false)
  }
  const items: [ReactNode, string, string, () => void, boolean][] = [
    [<CopyIcon size={16} />, 'Copy page', 'Copy page as Markdown for LLMs', copy, false],
    [<MarkdownLogoIcon size={16} />, 'View as Markdown', 'View this page as plain text', view, true],
    [<OpenAiLogoIcon size={16} />, 'Open in ChatGPT', 'Ask questions about this page', () => ask('https://chatgpt.com/?hints=search&q='), true],
    [<AsteriskIcon size={16} weight="bold" />, 'Open in Claude', 'Ask questions about this page', () => ask('https://claude.ai/new?q='), true],
  ]
  return (
    <div ref={box} data-skip className="relative shrink-0">
      <div className="inline-flex items-stretch overflow-hidden rounded-[10px] border border-line bg-bg text-[13.5px] font-medium text-fg">
        <button onClick={copy} className="flex items-center gap-2 whitespace-nowrap px-3 py-[7px] hover:bg-hover">
          {done ? <CheckIcon size={15} weight="bold" className="text-accent" /> : <CopyIcon size={15} />}
          {done ? 'Copied' : 'Copy page'}
        </button>
        <button onClick={() => setOpen((o) => !o)} className="border-l border-line px-2 hover:bg-hover" aria-label="More ways to use this page" aria-expanded={open}>
          <CaretDownIcon size={13} weight="bold" className={cx('transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="rise absolute left-0 top-[calc(100%+6px)] z-30 w-[290px] sm:left-auto sm:right-0 rounded-[12px] border border-line bg-raise p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.55)]">
          {items.map(([icon, title, sub, fn, out]) => (
            <button key={title} onClick={fn} className="flex w-full items-start gap-3 rounded-[9px] px-2.5 py-2 text-left hover:bg-hover">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-line bg-bg text-fg">{icon}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13.5px] font-medium text-fg">
                  {title} {out && <ArrowUpRightIcon size={11} className="text-dim" />}
                </span>
                <span className="block text-[12.5px] text-muted">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Page and prose ───────────────────────────────────────────────── */

export function Page({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-5">
        <h1 className="text-[34px] font-semibold leading-[1.12] tracking-[-0.03em] text-fg sm:text-[40px]">{title}</h1>
        <div className="hidden pt-2 sm:block">
          <CopyPage />
        </div>
      </div>
      {lead && <p className="mt-3 text-[18px] leading-[1.6] text-muted">{lead}</p>}
      <div className="mt-5 sm:hidden">
        <CopyPage />
      </div>
      <div className="mt-9">{children}</div>
    </>
  )
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slugify(children)
  return (
    <h2 id={anchor} className="group mb-3 mt-14 scroll-mt-32 text-[24px] font-semibold tracking-[-0.022em] text-fg first:mt-0">
      <a href={`#${anchor}`} className="plain">
        {children}
        <span className="ml-2 text-dim opacity-0 transition group-hover:opacity-100">#</span>
      </a>
    </h2>
  )
}

export function H3({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slugify(children)
  return (
    <h3 id={anchor} className="mb-2 mt-9 scroll-mt-32 text-[18px] font-semibold tracking-[-0.012em] text-fg">
      {children}
    </h3>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[16px] leading-[1.8] text-body">{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.75] text-body marker:text-dim">{children}</ul>
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="mt-4 list-decimal space-y-2 pl-5 text-[16px] leading-[1.75] text-body marker:text-dim">{children}</ol>
}

export function C({ children }: { children: ReactNode }) {
  return <code>{children}</code>
}

/** A pull quote: a line worth stopping on. */
export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="my-7 border-l-2 border-line pl-5 text-[16.5px] leading-[1.75] text-muted">{children}</blockquote>
}

/* ─── Code ─────────────────────────────────────────────────────────── */

type Lang = 'bash' | 'js' | 'ts' | 'python' | 'json' | 'php' | 'go' | 'http' | 'text'

const KEYWORDS = /^(const|let|var|await|async|import|from|export|function|return|if|else|true|false|null|def|class|new|try|catch|throw|in|of|for|while|None|True|False|require|package|func|err|nil|echo|use|public|static|curl)$/

/** A small highlighter: strings, numbers, keywords and comments. Enough to read, nothing more. */
function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === 'text') return [code]
  const hashComments = lang === 'bash' || lang === 'python'
  const rx = new RegExp(
    [
      hashComments ? '(#[^\\n]*)' : '(\\/\\/[^\\n]*)',
      '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)',
      '(\\b\\d+(?:\\.\\d+)?\\b)',
      '(\\b[A-Za-z_]+\\b)',
    ].join('|'),
    'g',
  )
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = rx.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [all, comment, str, num, word] = m
    const cls = comment ? 'tok-c' : str ? 'tok-s' : num ? 'tok-n' : word && KEYWORDS.test(word) ? 'tok-k' : null
    out.push(cls ? <span key={i++} className={cls}>{all}</span> : all)
    last = m.index + all.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export interface Snippet {
  label: string
  lang: Lang
  code: string
}

/** One block of code, or several as tabs: cURL, Node.js, Python. */
export function Code({ tabs, title }: { tabs: Snippet[]; title?: string }) {
  const [at, setAt] = useState(0)
  const [done, setDone] = useState(false)
  const s = tabs[at] ?? tabs[0]!
  return (
    <div className="my-6 overflow-hidden rounded-[12px] border border-code-line bg-code">
      <div className="flex items-center gap-1 border-b border-code-line px-3">
        {title && <span className="py-2.5 pr-2 text-[12.5px] font-medium text-white/75">{title}</span>}
        {tabs.length > 1 &&
          tabs.map((t, i) => (
            <button key={t.label} onClick={() => setAt(i)} className={cx('-mb-px border-b-2 px-2 py-2.5 text-[12.5px] font-medium transition', i === at ? 'border-lime text-white' : 'border-transparent text-white/45 hover:text-white/80')}>
              {t.label}
            </button>
          ))}
        {tabs.length === 1 && !title && <span className="py-2.5 text-[12.5px] font-medium text-white/50">{s.label}</span>}
        <button
          data-skip
          onClick={() => {
            void navigator.clipboard?.writeText(s.code).catch(() => undefined)
            setDone(true)
            setTimeout(() => setDone(false), 1400)
          }}
          className="ml-auto flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-white/55 hover:text-white"
          aria-label="Copy code"
        >
          {done ? <CheckIcon size={14} weight="bold" className="text-lime" /> : <CopyIcon size={14} />}
          {done ? 'Copied' : ''}
        </button>
      </div>
      <pre data-lang={s.lang} className={cx('px-4 py-4 font-mono text-[13px] leading-[1.75] text-[#E8E6DE]', s.lang === 'text' ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto')}>
        <code>{highlight(s.code, s.lang)}</code>
      </pre>
    </div>
  )
}

/** Shorthand for a single block. */
export const Block = ({ lang, code, label }: { lang: Lang; code: string; label?: string }) => <Code tabs={[{ label: label ?? LANG_LABEL[lang], lang, code }]} />

const LANG_LABEL: Record<Lang, string> = { bash: 'Terminal', js: 'JavaScript', ts: 'TypeScript', python: 'Python', json: 'JSON', php: 'PHP', go: 'Go', http: 'HTTP', text: 'Text' }

/* ─── Callouts ─────────────────────────────────────────────────────── */

export function Note({ type = 'note', title, children }: { type?: 'note' | 'tip' | 'warn'; title?: string; children: ReactNode }) {
  const Icon = type === 'warn' ? WarningIcon : type === 'tip' ? LightbulbIcon : InfoIcon
  return (
    <div
      data-md="text"
      className={cx(
        'my-6 flex gap-3 rounded-[12px] border px-4 py-3.5 text-[15px] leading-[1.7]',
        type === 'warn' ? 'border-warn-line bg-warn-bg text-warn-fg' : type === 'tip' ? 'border-tip-line bg-tip-bg text-tip-fg' : 'border-info-line bg-info-bg text-info-fg',
      )}
    >
      <Icon size={18} className="mt-[3px] shrink-0" />
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

/* ─── Steps ────────────────────────────────────────────────────────── */

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="relative mt-7 space-y-9 border-l border-line pl-8 [counter-reset:step]">{children}</ol>
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative [counter-increment:step]">
      <span className="absolute -left-[47px] top-0 flex size-[30px] items-center justify-center rounded-full border border-line bg-raise text-[13px] font-semibold text-fg before:content-[counter(step)]" />
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
      <div className="[&>*:first-child]:mt-2">{children}</div>
    </li>
  )
}

/* ─── Tables ───────────────────────────────────────────────────────── */

export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <>
      {/* A phone: each row as a card, the first cell its title and the rest under their headings. Copy page reads the table instead. */}
      <div data-skip className="my-6 divide-y divide-line overflow-hidden rounded-[12px] border border-line sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <div className="text-[15px] font-medium leading-snug text-fg">{r[0]}</div>
            {r.slice(1).map((c, j) => (
              <div key={j} className="text-[14.5px] leading-relaxed text-body">
                {head.length > 2 && <div className="mb-0.5 text-[12px] font-medium text-dim">{head[j + 1]}</div>}
                {c}
              </div>
            ))}
          </div>
        ))}
      </div>
    <div className="my-6 hidden overflow-x-auto rounded-[12px] border border-line sm:block">
      <table className="w-full min-w-[520px] border-collapse text-left text-[14.5px]">
        <thead>
          <tr className="border-b border-line bg-raise">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 text-[13px] font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-soft align-top first:border-t-0">
              {r.map((c, j) => (
                <td key={j} className={cx('px-4 py-3 leading-relaxed', j === 0 ? 'text-fg' : 'text-body')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

export type Param = { name: string; type: string; required?: boolean; children: ReactNode; values?: string[] }

/** Request or response fields: name, type, whether it's required, what it does. */
export function Params({ title = 'Body parameters', params }: { title?: string; params: Param[] }) {
  return (
    <div className="my-7">
      <div className="mb-2 text-[14px] font-semibold text-fg">{title}</div>
      <div className="divide-y divide-line border-y border-line">
        {params.map((p) => (
          <div key={p.name} className="py-4" data-md="text">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-mono text-[14px] font-semibold text-fg">{p.name}</span>
              <span className="font-mono text-[12.5px] text-dim">{p.type}</span>
              {title !== 'Fields' && (p.required ? <span className="text-[12px] font-medium text-req">required</span> : <span className="text-[12px] text-dim">optional</span>)}
            </div>
            <div className="mt-1.5 text-[15px] leading-[1.7] text-body">{p.children}</div>
            {p.values && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.values.map((v) => (
                  <span key={v} className="rounded-[6px] border border-line bg-raise px-1.5 py-px font-mono text-[12.5px] text-fg">
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Endpoints ────────────────────────────────────────────────────── */

const METHOD_STYLE = {
  GET: 'bg-get-bg text-get',
  POST: 'bg-post-bg text-post',
  PATCH: 'bg-patch-bg text-patch',
  DELETE: 'bg-del-bg text-del',
}

export function Method({ m, small }: { m: keyof typeof METHOD_STYLE; small?: boolean }) {
  return <span className={cx('shrink-0 rounded-[5px] font-mono font-semibold', small ? 'w-[38px] py-px text-center text-[10px] tracking-wide' : 'px-1.5 py-0.5 text-[11.5px]', METHOD_STYLE[m])}>{m}</span>
}

/** One endpoint: its own heading in "On this page", the method and path, then what it does. */
export function Endpoint({ id, title, method, path, children }: { id: string; title: string; method: keyof typeof METHOD_STYLE; path: string; children: ReactNode }) {
  return (
    <section className="mt-16 border-t border-line pt-12 first:mt-0 first:border-t-0 first:pt-0">
      <h2 id={id} className="scroll-mt-32 text-[24px] font-semibold tracking-[-0.022em] text-fg">
        {title}
      </h2>
      <div className="mt-4 flex items-center gap-3 overflow-x-auto rounded-[10px] border border-line bg-raise px-3.5 py-2.5" data-md="text">
        <Method m={method} />
        <span className="whitespace-nowrap font-mono text-[13.5px] text-fg">{path}</span>
      </div>
      {children}
    </section>
  )
}

/* ─── Odds and ends ────────────────────────────────────────────────── */

export function Accordion({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="my-6 divide-y divide-line overflow-hidden rounded-[12px] border border-line">
      {items.map(([title, body]) => (
        <details key={title} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-[16px] font-medium text-fg hover:bg-hover [&::-webkit-details-marker]:hidden">
            <CaretRightIcon size={13} weight="fill" className="text-muted transition group-open:rotate-90" />
            {title}
          </summary>
          <div data-md="text" className="px-5 pb-5 pl-[46px] text-[15.5px] leading-[1.75] text-body">
            {body}
          </div>
        </details>
      ))}
    </div>
  )
}

/** "Next steps": a short list of links, each with a line on what's there. */
export function Next({ links, title = 'Next steps' }: { links: [string, string, string][]; title?: string }) {
  return (
    <>
      <H2>{title}</H2>
      <ul className="mt-4 list-disc space-y-2.5 pl-5 text-[16px] leading-[1.7] text-body marker:text-dim">
        {links.map(([to, label, sub]) => (
          <li key={to}>
            <Link to={to}>{label}</Link>: {sub}
          </li>
        ))}
      </ul>
    </>
  )
}

/** How money moves: who pays, how, through us, to where. Drawn in boxes and lines. */
export function Flow() {
  const box = 'rounded-[10px] border border-line bg-bg px-3.5 py-2.5'
  return (
    <div data-skip className="my-8 rounded-[16px] border border-line bg-raise p-5">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-dim">Your customer pays with</div>
          {['Bank transfer', 'Money Moves app', 'USDC or USDT, 10 networks'].map((t) => (
            <div key={t} className={cx(box, 'text-[13.5px] text-fg')}>
              {t}
            </div>
          ))}
        </div>
        <ArrowRightIcon size={18} className="rotate-90 justify-self-center text-dim md:rotate-0" />
        <div className="rounded-[12px] border border-muted bg-bg px-4 py-4">
          <div className="text-[14.5px] font-semibold text-fg">Money Moves checkout</div>
          <div className="mt-1 text-[13px] leading-relaxed text-muted">Confirms the payment, converts it if it needs to, and settles it the moment it's paid.</div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lime px-2 py-0.5 text-[11.5px] font-semibold text-on-lime">webhook to your server</div>
        </div>
        <ArrowRightIcon size={18} className="rotate-90 justify-self-center text-dim md:rotate-0" />
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-dim">Lands where you choose</div>
          {[
            ['Your bank account', 'as local fiat'],
            ['A Money Moves account', 'as USDC in the app'],
            ['Your business wallet', 'as USDC, self-custody'],
          ].map(([t, s]) => (
            <div key={t} className={box}>
              <div className="text-[13.5px] text-fg">{t}</div>
              <div className="text-[12px] text-dim">{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
