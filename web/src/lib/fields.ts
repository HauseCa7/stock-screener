// How each judgment item is shown and edited.

export type FieldKind =
  | { t: "text"; long?: boolean }
  | { t: "bool"; yes: string; no: string }
  | { t: "score"; bands: [string, string, string] }
  | { t: "enum"; options: [string, string][] }
  | { t: "list" }
  | { t: "boolmap"; fields: [string, string][] }
  | { t: "trimap"; fields: [string, string][] }
  | { t: "int" }
  | { t: "tam" }
  | { t: "ceo" }
  | { t: "moats" };

export interface FieldDef {
  label: string;
  kind: FieldKind;
  help?: string;
}

const yes = (y = "Yes", n = "No") => ({ t: "bool" as const, yes: y, no: n });

export const MOAT_TYPES: [string, string][] = [
  ["network_effects", "Network effects"],
  ["technology_patents", "Technology and patents"],
  ["switching_costs", "Switching costs"],
  ["scale", "Scale"],
  ["regulation", "Regulation"],
  ["brand", "Brand"],
];

export const FIELDS: Record<string, FieldDef> = {
  "step1.trend_name": { label: "The secular trend", kind: { t: "text" } },
  "step1.trend_checks": {
    label: "The trend test",
    kind: {
      t: "boolmap",
      fields: [
        ["real_demand", "Real demand and paying customers"],
        ["sustainable_growth", "Sustainable revenue and earnings growth"],
        ["moat_not_commodity", "A moat, not a commodity"],
        ["tailwinds", "Regulatory or government tailwinds"],
        ["visible_adoption", "Adoption you can see in the real world"],
      ],
    },
  },
  "step1.market_story": { label: "Line 1 · The market's story", kind: { t: "text", long: true } },
  "step1.becoming": { label: "Line 2 · What it's becoming", kind: { t: "text", long: true } },
  "step1.gap": { label: "Is there a gap between the two lines?", kind: yes("Yes, there's a gap", "No gap, no edge") },
  "step1.skip_zone": {
    label: "Skip zone",
    kind: {
      t: "enum",
      options: [["none", "None"], ["small_cap", "Small cap"], ["chinese", "Chinese company"], ["commodity", "Commodity"], ["airline", "Airline"], ["seasonal", "Seasonal business"], ["startup", "Startup"]],
    },
  },
  "fact.founded_year": { label: "Year founded", kind: { t: "int" } },
  "fact.is_software": { label: "Software or subscription business?", kind: yes(), help: "Decides whether the Rule of 40 counts." },
  "step3.legal_overhang": { label: "Major regulatory or legal overhang?", kind: yes("Yes, there is one", "No") },

  "step4.sentence": { label: "In one sentence", kind: { t: "text", long: true }, help: "[Company] provides X that helps Y achieve Z, and charges [revenue model]." },
  "step4.pain": { label: "What pain are we curing?", kind: { t: "text", long: true } },
  "step4.who": { label: "Who's in pain, and why?", kind: { t: "text", long: true } },
  "step4.why_us": { label: "Why us and not the competitor?", kind: { t: "text", long: true } },

  "step5.broad_market": { label: "Sells into a broad market?", kind: yes("Broad", "Niche") },
  "step5.tam": { label: "Market size", kind: { t: "tam" } },
  "step5.big_enough": { label: "Big enough for the growth we're betting on?", kind: yes() },

  "step7.revenue_engine": { label: "How the money gets made", kind: { t: "text", long: true } },

  "step9.moats": { label: "Moats it has", kind: { t: "moats" } },
  "step9.direction": { label: "Moat over time", kind: { t: "enum", options: [["strengthening", "Getting stronger"], ["stable", "Stable"], ["weakening", "Getting weaker"]] } },
  "step9.why_choose": { label: "Why do customers choose it?", kind: { t: "text", long: true } },
  "step9.why_stay": { label: "Why do they stay, for the next 10 years?", kind: { t: "text", long: true } },
  "step9.copyable": { label: "Could 20 engineers per engineer copy it in a year?", kind: yes("Yes, copyable", "No, it's a real moat") },

  "step10.ceo": { label: "The CEO", kind: { t: "ceo" } },
  "step10.checklist": {
    label: "CEO checklist",
    kind: {
      t: "trimap",
      fields: [
        ["c01_track_record", "Track record of execution: growth, margins, innovation"],
        ["c02_skin_in_game", "Skin in the game: buys stock on the open market"],
        ["c03_tenure_10y_founder", "10+ years in the role, ideally the founder"],
        ["c04_capital_allocation", "Disciplined capital allocation"],
        ["c05_straight_answers", "Straight answers, even when they don't look good"],
        ["c06_earnings_beats", "Consistent earnings beats"],
        ["c07_attracts_talent", "A leader great people want to work for"],
        ["c08_results_not_excuses", "Results, not excuses"],
      ],
    },
  },
  "step10.red_flags": {
    label: "Instant red flags",
    kind: { t: "boolmap", fields: [["clown_ceo", "A clown CEO"], ["co_ceo", "A co-CEO structure"], ["acquisition_spree", "An acquisition shopping spree"]] },
  },

  "step11.reasons_wrong": { label: "Reasons the thesis is wrong", kind: { t: "list" } },
  "step11.bear_case": { label: "The bear case", kind: { t: "text", long: true } },
  "step11.red_flags": {
    label: "Red flags that end the research",
    kind: {
      t: "trimap",
      fields: [
        ["fraud_or_accounting", "Fraud or an accounting scandal, even a suspicion"],
        ["auditor_change", "An auditor change"],
        ["insider_selling", "Insiders selling hard while the stock runs"],
        ["over_expansion", "Over-expansion or an acquisition spree"],
      ],
    },
  },
  "step11.hype_trap": {
    label: "Hype trap signals",
    kind: { t: "boolmap", fields: [["no_revenue", "No revenue"], ["weak_fundamentals", "Weak fundamentals"], ["constant_share_sales", "Constant share sales to raise cash"], ["media_hype", "Nonstop media hype"]] },
  },
};

/** Which judgment items belong to which step. */
export const STEP_FIELDS: Record<number, string[]> = {
  1: ["step1.trend_name", "step1.trend_checks", "step1.market_story", "step1.becoming", "step1.gap", "step1.skip_zone"],
  3: ["fact.founded_year", "fact.is_software", "step3.legal_overhang"],
  4: ["step4.sentence", "step4.pain", "step4.who", "step4.why_us"],
  5: ["step5.broad_market", "step5.tam", "step5.big_enough"],
  7: ["step7.revenue_engine"],
  9: ["step9.moats", "step9.direction", "step9.why_choose", "step9.why_stay", "step9.copyable"],
  10: ["step10.ceo", "step10.checklist", "step10.red_flags"],
  11: ["step11.reasons_wrong", "step11.bear_case", "step11.red_flags", "step11.hype_trap"],
};

/** Scorecard categories shown inside a step. */
export const STEP_SCORES: Record<number, string[]> = {
  1: ["secular_trend"],
  5: ["recession_proof"],
  9: ["moat"],
  10: ["ceo", "culture", "talent"],
};

export const STEP_BLURB: Record<number, string> = {
  1: "Start with the future, not a ticker. Where is a new game being played, and what does the market misunderstand about this company?",
  2: "Three questions. Pass at least two; a single failure needs a valid reason.",
  3: "Most companies die right here. All six must pass, both tests must pass, and any instant kill ends it.",
  4: "You can't evaluate numbers on a business you don't understand. If the sentence won't come out clean, you're not ready.",
  5: "Great tech in a tiny market is a bad investment. Check the size of the prize yourself.",
  6: "13 categories, each 0, 5 or 10, on the last twelve months. Score the subjective ones as harshly as you can.",
  7: "Five years from the annual reports, four lines. Read income from operations, not net income.",
  8: "Read the balance sheet like a banker deciding whether to lend. Compare against peers in the same industry.",
  9: "Without a moat, revenue growth is irrelevant. Name it, then pressure-test it.",
  10: "No investment unless you're amazed by the CEO. Track record comes first.",
  11: "By now you like this stock. That's when you're most dangerous to yourself. Try to kill it.",
  12: "Valuation is a tool, not an answer. Even the bear case has to be attractive.",
};

export const GROUP_LABEL: Record<string, string> = {
  trend: "Secular trend",
  business: "Business, market and revenue engine",
  moat: "Moat",
  management: "Management",
  risks: "Bear case and red flags",
};

/** Which AI group drafts the items in a step. */
export const STEP_GROUP: Record<number, string> = { 1: "trend", 3: "risks", 4: "business", 5: "business", 7: "business", 9: "moat", 10: "management", 11: "risks" };
