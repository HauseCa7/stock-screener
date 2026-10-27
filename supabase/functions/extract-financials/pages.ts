// Picks the pages of a report worth sending to Claude: the three financial statements, the debt
// and per-share notes, and the cover. Kept free of imports so it can be tested on real reports.

/** Count of number-like tokens on a page (to tell statement tables from prose). */
export function numericDensity(text: string): number {
  return (text.match(/\(?\$?\d[\d,]*\.?\d*\)?/g) ?? []).length;
}

const HEADINGS: Record<string, RegExp> = {
  income: /statements?\s+of\s+(consolidated\s+)?(operations|income|earnings)|income\s+statements?|statements?\s+of\s+(comprehensive\s+)?(income|loss|profit)|profit\s+or\s+loss/i,
  balance: /balance\s+sheets?|statements?\s+of\s+financial\s+(position|condition)/i,
  cash: /statements?\s+of\s+cash\s+flows?|cash\s+flows?\s+statements?/i,
};

const NOTES = /note\s*\d+\s*[\u2014\u2013:.-]+\s*[^\n]{0,50}?\b(debt|borrowings|financing activities|credit facilit\w*|notes payable|convertible (senior )?notes|leases)\b|^\s*(debt|long-term debt|borrowings)\s*$/im;
const EPS_NOTE = /note\s*\d+\s*[\u2014\u2013:.-]+\s*[^\n]{0,30}?(earnings|income|loss)[^\n]{0,20}?per share/i;

// Line items that identify each statement by its contents, for PDFs whose title text is missing
// or attached to the wrong page.
const CONTENT: Record<string, RegExp[]> = {
  income: [/total (net )?revenues?|net sales|total revenues|operating revenues|revenues?\s*:/i, /operating expenses|cost of (revenue|sales)/i, /net (income|loss|earnings)/i, /per share/i, /diluted/i, /income (taxes|tax expense)|provision for income tax/i],
  balance: [/total assets/i, /total liabilities/i, /(stockholders|shareholders)['’]? equity/i, /current assets/i, /cash and cash equivalents/i, /accumulated deficit|retained earnings/i],
  cash: [/operating activities/i, /investing activities/i, /financing activities/i, /net cash (provided|used)/i, /depreciation/i, /end of (the )?(period|year)/i],
};
const isHeading = (t: string, n = 600) => Object.values(HEADINGS).some((h) => h.test(t.slice(0, n)));
/** "(in millions)", "(Millions of Dollars)", "(Dollars in thousands)", "(In millions, except per share data)". */
const UNITS = /\(\s*(in\s+|dollars\s+in\s+|amounts\s+in\s+)?(millions|thousands|billions)\b|\(\s*(millions|thousands|billions)\s+of\b/i;
/**
 * A contents page or index lists several statements by name near the top. Real statement pages
 * carry only their own title, so a page naming two or more kinds of statement is skipped.
 */
const isContents = (t: string) => Object.values(HEADINGS).filter((h) => h.test(t.slice(0, 2500))).length >= 2 && /contents|index|page/i.test(t.slice(0, 2500));

export function selectPages(pages: string[]): { idx: number[]; snippets: string[] } {
  const chosen = new Set<number>();
  const addWithNext = (i: number) => {
    chosen.add(i);
    const next = pages[i + 1];
    // Statements and notes often continue on the next page.
    if (next && numericDensity(next) >= 20 && !isHeading(next, 300)) chosen.add(i + 1);
  };
  for (const re of Object.values(HEADINGS)) {
    // Rank pages so the statement itself beats pages that merely mention it:
    // title near the top, followed by "(in millions…)", with a table of numbers on the page.
    const ranked = pages
      .map((t, i) => {
        const head = t.slice(0, 600);
        const m = re.exec(head);
        if (!m || /index to (consolidated )?financial statements/i.test(head) || isContents(t)) return null;
        const d = numericDensity(t);
        if (d < 25) return null;
        let score = Math.min(d, 150);
        if (m.index < 250) score += 100;
        if (UNITS.test(t.slice(m.index, m.index + 300))) score += 200;
        if (m[0] === m[0].toUpperCase()) score += 50;
        return { i, score };
      })
      .filter((x): x is { i: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);
    const strong = ranked.filter((x) => x.score >= 300).slice(0, 2);
    for (const { i } of strong.length ? strong : ranked.slice(0, 2)) addWithNext(i);
  }
  // By contents: the page with the most of a statement's line items, even without a title.
  for (const pats of Object.values(CONTENT)) {
    const best = pages
      .map((t, i) => ({ i, hits: pats.filter((r) => r.test(t)).length, d: numericDensity(t) }))
      .filter((x) => x.hits >= 5 && x.d >= 25)
      .sort((a, b) => b.hits - a.hits || b.d - a.d)[0];
    if (best) addWithNext(best.i);
  }
  // Fallback: no clear statements found → most number-dense pages that mention a heading anywhere.
  if (chosen.size === 0) {
    pages
      .map((t, i) => ({ i, d: numericDensity(t), h: Object.values(HEADINGS).some((r) => r.test(t)) }))
      .filter((p) => p.h)
      .sort((a, b) => b.d - a.d)
      .slice(0, 10)
      .forEach((p) => chosen.add(p.i));
  }
  // Debt and lease footnotes, so total debt includes the current portion and finance leases.
  let notes = 0;
  pages.forEach((t, i) => {
    const m = NOTES.exec(t.slice(0, 800));
    // Skip pages that only point to the note ("Refer to Note 11 - Financing Activities").
    const pointer = m && /(refer|see|in)\s+(to\s+)?$/i.test(t.slice(Math.max(0, m.index - 12), m.index));
    if (notes < 4 && m && !pointer && numericDensity(t) >= 10) { addWithNext(i); notes++; }
  });
  // Earnings-per-share note, for when the income statement doesn't show diluted EPS and shares.
  const eps = pages.findIndex((t) => EPS_NOTE.test(t.slice(0, 800)) && numericDensity(t) >= 15);
  if (eps >= 0) addWithNext(eps);
  // Cover page(s) for shares outstanding.
  chosen.add(0);
  if (pages.length > 1) chosen.add(1);

  const snippets: string[] = [];
  const re = /(net\s+(dollar|revenue)\s+(retention|expansion)|dollar-based\s+net\s+(retention|expansion))/i;
  pages.forEach((t, i) => {
    if (snippets.length >= 3) return;
    const m = re.exec(t);
    if (m) {
      const s = Math.max(0, m.index - 500);
      snippets.push(`[page ${i + 1}] …${t.slice(s, m.index + 700)}…`);
    }
  });
  return { idx: [...chosen].sort((a, b) => a - b), snippets };
}

