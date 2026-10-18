import puppeteer, { type Browser } from "puppeteer";
import type { Statement } from "./statement";
import { statementHtml, esc } from "./statement-html";

/**
 * The statement, printed.
 *
 * Chromium does the pagination, which is the reason it is here: a statement is
 * as long as the period is, and a browser is the only thing that will repeat a
 * table header onto every sheet and break between rows rather than through
 * them without being told where the pages are.
 *
 * One browser is launched per job and closed after. That is slower than
 * holding one open, and it is the right trade: statements are a cold path
 * somebody asks for now and then, and a long-lived Chromium is 200MB of
 * resident memory sitting there between requests plus a process to supervise.
 */

/**
 * How many may render at once.
 *
 * Each one is a browser, and a browser is not free. Without this, a handful of
 * people asking together - or one person tapping the button repeatedly - is
 * that many Chromiums at once, which is how a server that was fine becomes a
 * server that is out of memory.
 */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function slot(): Promise<() => void> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    running--;
    waiting.shift()?.();
  };
}

/** The line every loose sheet needs to identify itself, plus where it sits. */
function footer(s: Statement): string {
  const who = [s.user.username ? `@${s.user.username}` : s.user.name, s.number]
    .filter(Boolean)
    .join(" · ");
  return `
  <div style="width:100%;font-size:7pt;color:#5F6557;font-family:'Segoe UI',system-ui,sans-serif;
              padding:0 16mm;display:flex;justify-content:space-between;align-items:baseline;">
    <span>Money Moves &middot; ${esc(who)}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}

export async function renderStatementPdf(s: Statement): Promise<Buffer> {
  const release = await slot();
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      /**
       * The system Chromium where the platform provides one.
       *
       * Set PUPPETEER_EXECUTABLE_PATH (with PUPPETEER_SKIP_DOWNLOAD) and the
       * image installs one browser instead of two - the deploy carries a
       * Chromium either way, and downloading a second into a cache that the
       * build and the runtime may not share is how this fails in production
       * while working perfectly here.
       */
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
      /**
       * Containers do not give Chromium what its sandbox needs, and the
       * alternative is running the image as root with extra capabilities. The
       * page it opens is HTML this server built from its own database - no
       * remote script, no user-supplied markup - so there is nothing here for
       * a sandbox to contain.
       */
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setContent(statementHtml(s), { waitUntil: "load", timeout: 20_000 });
    /**
     * The webfonts arrive over the network after load, and a page printed
     * before they land prints in the fallback face - which is a different
     * document, silently.
     *
     * Bounded, because a font shop that is slow or blocked should delay a
     * statement, not hang one: past this it prints in whatever it has.
     */
    await Promise.race([
      page.evaluate("document.fonts.ready"),
      new Promise((r) => setTimeout(r, 8_000)),
    ]).catch(() => {});

    const pdf = await page.pdf({
      format: "a4",
      // The letterhead band bleeds to the edge, which only works if the
      // backgrounds print at all.
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer(s),
      // Matches the @page margin in the stylesheet; the bottom leaves room
      // for the footer template, which is drawn inside the margin.
      margin: { top: "14mm", right: "16mm", bottom: "20mm", left: "16mm" },
      timeout: 60_000,
    });

    return Buffer.from(pdf);
  } finally {
    // Closed even when the render threw. A browser leaked per failure is a
    // slow leak that only shows up under the conditions that caused it.
    await browser?.close().catch(() => {});
    release();
  }
}

/** A name that means something in a downloads folder six months from now. */
export function statementFilename(s: Statement): string {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return `money-moves-statement-${d(s.from)}-to-${d(s.to)}.pdf`;
}
