// A valuation-aware DCA plan for great businesses that look expensive.
//
// The guide says to buy slowly: a fixed amount on a fixed date, never a lump sum. Waiting for a
// great company to become cheap often means never owning it, so instead of a buy/don't-buy line
// at the bear-case value, this keeps buying on schedule and scales each month's amount by where
// the price sits against the DCF values from step 12. Whatever isn't invested in a pricey month
// is set aside for this stock and goes in when the price is back at or below fair value.
import type { Valuation } from "./dcf";

export type ZoneId = "below_bear" | "fair" | "full" | "rich" | "stretched" | "unpriced";

export interface Zone {
  id: ZoneId;
  label: string;
  /** Upper price bound of the zone (null = no upper bound). */
  upTo: number | null;
  /** Share of the planned monthly amount to invest while the price is in this zone. */
  multiplier: number;
  note: string;
}

export interface DcaPlan {
  zone: Zone;
  zones: Zone[];
  price: number | null;
  /** Planned monthly amount, if the user set one. */
  monthly: number | null;
  months: number;
  /** This month's amount: monthly × multiplier. */
  thisMonth: number | null;
  /** Set aside this month for later: monthly − thisMonth (never negative). */
  setAside: number | null;
}

export const DEFAULT_MONTHS = 18;

export function dcaPlan(v: Valuation, price: number | null, monthly: number | null = null, months = DEFAULT_MONTHS): DcaPlan {
  const bear = v.cases.bear.perShare;
  const base = v.cases.base.perShare;
  const bull = v.cases.bull.perShare;
  const priced = price !== null && bear !== null && base !== null && bull !== null && bear > 0 && base > 0 && bull > 0;
  const stretchedGrowth = v.growthGapPct !== null && v.growthGapPct < 0;

  const zones: Zone[] = priced
    ? [
        { id: "below_bear", label: "Below the bear-case value", upTo: bear, multiplier: 1.5, note: "Cheap even on the harshest case. Buy faster and use what you set aside earlier." },
        { id: "fair", label: "Between bear and fair value", upTo: base, multiplier: 1, note: "At or below fair value (10%). Full amount, plus anything set aside." },
        { id: "full", label: "Between fair and bull value", upTo: bull, multiplier: 0.75, note: "Priced for things going well. Keep buying, a bit lighter." },
        { id: "rich", label: "Above the bull-case value", upTo: null, multiplier: 0.5, note: "Expensive, but the market isn't asking for more growth than the company already delivers." },
        { id: "stretched", label: "Above bull, and the market wants more growth than delivered", upTo: null, multiplier: 0.25, note: "Starter amounts only. The price needs faster growth than the company has shown." },
      ]
    : [{ id: "unpriced", label: "No usable valuation yet", upTo: null, multiplier: 0.5, note: "The DCF can't value it (missing data or negative free cash flow). Half amounts until it can." }];

  let zone: Zone;
  if (!priced) zone = zones[0];
  else if (price! <= bear!) zone = zones[0];
  else if (price! <= base!) zone = zones[1];
  else if (price! <= bull!) zone = zones[2];
  else zone = stretchedGrowth ? zones[4] : zones[3];

  const thisMonth = monthly !== null ? monthly * zone.multiplier : null;
  return {
    zone,
    zones,
    price,
    monthly,
    months,
    thisMonth,
    setAside: monthly !== null && thisMonth !== null ? Math.max(0, monthly - thisMonth) : null,
  };
}
