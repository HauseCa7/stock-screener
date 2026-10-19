// The valuation-aware DCA plan: keep buying a great business on schedule, scaled by price.
import { useEffect, useState } from "react";
import { DEFAULT_MONTHS, type DcaPlan } from "../engine/dca";
import { perShare } from "../engine/format";
import type { AssessmentMap } from "../engine/types";
import { setUserValue } from "../lib/api";

const dollars = (v: number | null) => (v === null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const mult = (x: number) => `${Math.round(x * 100)}%`;

export function DcaPanel({ plan, a, companyId, onSaved, quality }: { plan: DcaPlan; a: AssessmentMap; companyId: string; onSaved: () => void; quality: boolean }) {
  const saved = a["dca.plan"]?.user_value ?? {};
  const [monthly, setMonthly] = useState<string>(saved.monthly != null ? String(saved.monthly) : "");
  const [months, setMonths] = useState<string>(String(saved.months ?? DEFAULT_MONTHS));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setMonthly(saved.monthly != null ? String(saved.monthly) : "");
    setMonths(String(saved.months ?? DEFAULT_MONTHS));
  }, [saved.monthly, saved.months]);

  async function save() {
    setErr(null);
    const mo = monthly.trim() === "" ? null : Number(monthly.replace(/[$,\s]/g, ""));
    const n = Number(months);
    if (mo !== null && (!Number.isFinite(mo) || mo <= 0)) return setErr("Enter a monthly amount above zero, or leave it blank.");
    if (!Number.isInteger(n) || n < 1 || n > 120) return setErr("Months should be a whole number from 1 to 120.");
    try {
      await setUserValue(companyId, "dca.plan", { monthly: mo, months: n });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const changed = monthly !== (saved.monthly != null ? String(saved.monthly) : "") || months !== String(saved.months ?? DEFAULT_MONTHS);
  let lower: number | null = null;

  return (
    <section className="panel stack" style={{ background: "var(--surface-2)" }}>
      <div>
        <h3>DCA plan</h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Waiting for a great company to get cheap often means never owning it. So keep buying on a fixed date, as the guide says,
          and let the price set how much: more when it's cheap against the valuation, less when it's rich. What you don't invest
          in a pricey month is set aside for this stock and goes in when the price is back at or below fair value.
          {!quality && " This plan is meant for companies that pass steps 1 to 11."}
        </p>
      </div>

      <div className="row" style={{ alignItems: "end" }}>
        <label className="field">Planned per month
          <input type="text" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="e.g. 500" style={{ width: 120 }} />
        </label>
        <label className="field">Over how many months
          <input type="text" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} style={{ width: 80 }} />
        </label>
        <button className="btn sm" disabled={!changed} onClick={save}>Save</button>
        {plan.monthly !== null && (
          <span style={{ marginLeft: "auto", textAlign: "right" }}>
            <span className="muted small">This month at {perShare(plan.price)}</span>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22 }}>{dollars(plan.thisMonth)}</div>
            {plan.setAside ? <span className="muted small">{dollars(plan.setAside)} set aside</span> : null}
          </span>
        )}
      </div>
      {err && <div className="notice error">{err}</div>}

      <ul className="zones" aria-label="Price zones">
        {plan.zones.map((z) => {
          const from = lower;
          if (z.upTo !== null) lower = z.upTo;
          const range = z.id === "unpriced" ? "" : z.upTo !== null ? (from === null ? `up to ${perShare(z.upTo)}` : `${perShare(from)} to ${perShare(z.upTo)}`) : `above ${perShare(from)}`;
          return (
            <li key={z.id} className={z.id === plan.zone.id ? "now" : ""}>
              <div>
                <div>{z.label}{z.id === plan.zone.id && <span className="tag" style={{ marginLeft: 8 }}>Today</span>}</div>
                <div className="muted small">{z.note}</div>
              </div>
              <span className="upto">{range}</span>
              <span className="mult" title="Share of the planned monthly amount">
                {plan.monthly !== null ? dollars(plan.monthly * z.multiplier) : mult(z.multiplier)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small" style={{ margin: 0 }}>
        Zone prices come from the valuation (bear 12%, fair 10%, bull 8%), so they move when you change its inputs or new reports
        arrive. Re-check the zone on each buying date. Education, not financial advice.
      </p>
    </section>
  );
}

const ZONE_SHORT: Record<string, string> = {
  below_bear: "Below bear value",
  fair: "Fair value or below",
  full: "Above fair value",
  rich: "Above bull value",
  stretched: "Stretched",
  unpriced: "No valuation yet",
};

/**
 * Compact view for the Companies table: the five price zones from cheap (left) to stretched
 * (right), today's zone filled, and how much of the monthly amount that zone buys.
 */
export function DcaGauge({ plan }: { plan: DcaPlan }) {
  if (plan.zone.id === "unpriced") {
    return <span className="muted small" title={plan.zone.note}>No valuation yet</span>;
  }
  const order: string[] = ["below_bear", "fair", "full", "rich", "stretched"];
  const at = order.indexOf(plan.zone.id);
  const fair = plan.zones.find((z) => z.id === "fair")?.upTo ?? null;
  const vsFair = plan.price !== null && fair ? (plan.price / fair - 1) * 100 : null;
  const pace = plan.thisMonth !== null ? `${dollars(plan.thisMonth)}/mo` : `${mult(plan.zone.multiplier)} pace`;
  return (
    <div className="dcagauge" title={`${plan.zone.label}. ${plan.zone.note}`}>
      <span className="segs" role="img" aria-label={`Price zone ${at + 1} of 5: ${plan.zone.label}`}>
        {order.map((z, i) => <i key={z} className={i === at ? `on z${i}` : ""} />)}
      </span>
      <span><b>{pace}</b> <span className="muted small">· {ZONE_SHORT[plan.zone.id]}</span></span>
      {vsFair !== null && (
        <span className="muted small">{perShare(plan.price)} vs. fair {perShare(fair)} ({vsFair >= 0 ? "+" : ""}{vsFair.toFixed(0)}%)</span>
      )}
    </div>
  );
}
