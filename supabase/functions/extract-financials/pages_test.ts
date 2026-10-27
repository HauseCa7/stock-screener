// Run: deno test supabase/functions/extract-financials/pages_test.ts
import { selectPages } from "./pages.ts";

const nums = (n: number) => Array.from({ length: n }, (_, i) => `${(i + 1) * 137},${i}00`).join(" ");
const filler = (n: number) => Array.from({ length: n }, () => "Discussion of results and risk factors without tables.").join(" ");

Deno.test("skips the contents page and finds statements titled '(Millions of Dollars)'", () => {
  const pages = [
    "Cover page. Shares outstanding 338,000,000",
    "TABLE OF CONTENTS PAGE Item 1. Financial Statements 1 Condensed Consolidated Statements of Operations 1 Condensed Consolidated Balance Sheets 3 Condensed Consolidated Statements of Cash Flows 5 " + nums(60),
    filler(40), filler(40), filler(40),
    "VISTRA CORP. CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited) (Millions of Dollars, Except Share Data) Operating revenues " + nums(40) + " Net income per share diluted",
    "VISTRA CORP. CONDENSED CONSOLIDATED BALANCE SHEETS (Unaudited) (Millions of Dollars) ASSETS Current assets " + nums(45) + " Total assets",
    "VISTRA CORP. CONDENSED CONSOLIDATED BALANCE SHEETS (Unaudited) (Millions of Dollars) Total liabilities " + nums(30) + " Total equity",
    "VISTRA CORP. CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS (Millions of Dollars) Cash flows operating activities investing activities " + nums(40),
    filler(40),
  ];
  const { idx } = selectPages(pages);
  for (const want of [5, 6, 7, 8]) if (!idx.includes(want)) throw new Error(`page ${want + 1} missing: got ${idx.map((i) => i + 1)}`);
  if (idx.includes(1) && !idx.includes(0)) throw new Error("unexpected");
});
