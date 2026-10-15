# Island Screener

A private stock screener that runs Tom Nash's 12-step research process ("fail one step and the company is off the island") on companies you upload reports for.

- **Reads reports.** Upload annual and quarterly reports (PDF). The text is extracted in your browser, and Claude pulls the financial-statement figures into a table you can correct.
- **Scores everything.** All 12 steps, every instant kill, the 13-category scorecard, the Loan Officer ratios, the reverse DCF and the bull/base/bear DCF are calculated from those figures.
- **Drafts the judgment calls.** Claude drafts the subjective items (trend story, moat, CEO, culture, talent, bear case, and so on) with its reasoning and quotes from the reports. You override any of them; your answers are kept and marked as yours.

## How it's built

| Part | Where |
| --- | --- |
| Website (React + Vite) | `web/`, published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` |
| Database, login, file storage | Supabase project `mwwjyirhpxccdscoklqw` (Canada Central) |
| Server functions | `supabase/functions/` |
| Scoring engine | `web/src/engine/` (pure TypeScript, unit-tested with `npx vitest run`) |

Server functions:

- `extract-financials`: picks the statement pages and cover page of one report and asks Claude for the line items.
- `draft-assessments`: sends the prose sections of the latest reports to Claude, once per section group (trend, business, moat, management, risks). The documents are prompt-cached, so the four calls after the first cost much less.
- `market-data`: Yahoo Finance (unofficial endpoints) for price, market cap, forward P/E, PEG, short interest, institutional ownership, 5-year return vs. SPY and EPS surprises; Alpha Vantage fills gaps if Yahoo fails. Toronto symbols: SHOP.TO (Yahoo) and SHOP.TRT (Alpha Vantage) are mapped automatically.

Each function imports `./common.ts`. When deploying, copy `supabase/functions/_shared/common.ts` next to each `index.ts`.

Secrets, set in Supabase → Edge Functions → Secrets (never in this repo): `ANTHROPIC_API_KEY`, `ALPHAVANTAGE_API_KEY`, and `ANTHROPIC_WORKSPACE_ID` only when the Anthropic key is an organization-level key not scoped to a workspace.

Security: only the email in `public.app_owners` can read or write anything. This is enforced by row-level security on every table and the storage bucket, and checked again in every server function. The Supabase URL and publishable key in `web/src/lib/supabase.ts` are public by design.

## Rules and interpretations

The guide leaves a few things open. This is how the tool reads them:

- **Scorecard max.** 13 categories × 10 = 130, not 125. The guide's cut-offs are used as written: 100+ exceptional, 75–99 watchlist, under 75 no-go.
- **Gaps between bands score low.** For example, beating the S&P by 0–10 points over five years scores 0.
- **Fails don't stop the analysis.** A failed step marks the company "Off the island" with its reasons, and the remaining steps still run. You can override any step with a written reason.
- **Step 1's five trend tests judge the trend, not the company.** The guide says "a trend is real only if it checks all five", so they're asked of the trend (e.g. AI infrastructure). The company is judged on how squarely it sits on the trend (scorecard), the market misreading it (price aside; price is step 12) and the skip zones.
- **Claude flags, you decide.** A check that fails on Claude's judgment shows as a flag (!) and the step as "Needs your call". Only checks from numbers, market data or your own answers eliminate automatically. Agreeing with a flag (or answering the same way yourself) sends the company off the island.
- **Step 12 never eliminates.** A company that passes steps 1–11 but is priced above the bear-case value is "Great business · DCA in". Its DCA plan keeps buying on a fixed date and scales the amount by price zone: 150% below the bear value, 100% up to fair value (10%), 75% up to the bull value, 50% above it, 25% when the market also wants more growth than the company has delivered. Money not invested is set aside for the next time the price is at or below fair value.
- **Step 2.** One failure passes only with a valid reason you select: infrastructure leverage, or a clear path to profitability.
- **Rule of 40.** Calculated for every company, but pass/fail only for software and subscription businesses.
- **"Last twelve months."** Uses four quarters when available, otherwise FY + YTD − prior YTD. Growth falls back to matching year-to-date columns, then the last two fiscal years.
- **Step 10 is strict.** It needs a CEO score of 10 ("amazed by the CEO"), 6 of 8 checklist items, and no red flags.
- **Valuation.** Starting revenue is LTM revenue. Growth is the 3-year average, trimmed 20% by default. FCF margin is the 3-year average. Discount rates are 8 / 10 / 12%, with 4% terminal growth. Step 12 passes when the bear-case value per share is above the price.

## Local development

```bash
cd web
npm install
npm run dev      # http://localhost:5173/stock-screener/
npx vitest run   # engine tests
```
