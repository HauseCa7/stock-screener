// A guided page for the market numbers that couldn't be fetched automatically.
// Grouped by Yahoo Finance page, so each page only needs to be opened once.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SourceTag } from "../components/Assessment";
import { computeMetrics } from "../engine/metrics";
import { loadCompany, saveMarketFields, type Bundle } from "../lib/api";
import { MARKET_FIELDS, missingFields, PAGE_NAME, parseInput, showInput, yahooSymbol, yahooUrl, type MarketField, type YahooPage } from "../lib/marketFields";

const PAGE_ORDER: YahooPage[] = ["summary", "statistics", "holders", "analysis", "spx"];

export default function MarketInputs() {
  const { id } = useParams();
  const nav = useNavigate();
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    loadCompany(id!).then(setB).catch((e) => setErr(e.message));
  }, [id]);

  const shares = useMemo(() => (b ? computeMetrics(b.financials, b.market).shares : null), [b]);
  const missing = useMemo(() => (b ? missingFields(b.market, shares) : []), [b, shares]);

  // Live parse results, so mistakes show while typing.
  const parsed = useMemo(() => {
    const out: Record<string, { value: number | null; error?: string }> = {};
    for (const f of MARKET_FIELDS) {
      if (!(f.k in draft)) continue;
      try {
        out[f.k] = { value: parseInput(draft[f.k], f.format) };
      } catch (e: any) {
        out[f.k] = { value: null, error: e.message };
      }
    }
    return out;
  }, [draft]);

  if (err) return <div className="notice error">{err}</div>;
  if (!b) return <p className="muted">Loading…</p>;

  const c = b.company;
  const sym = yahooSymbol(c.ticker, c.data_symbol);
  const shown = showAll ? MARKET_FIELDS : MARKET_FIELDS.filter((f) => missing.includes(f) || f.k in draft);
  const changes = Object.entries(parsed).filter(([, p]) => !p.error && p.value !== null);
  const hasErrors = Object.values(parsed).some((p) => p.error);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveMarketFields(c.id, Object.fromEntries(changes.map(([k, p]) => [k, p.value])), b!.market);
      setSaved(changes.length);
      setDraft({});
      setB(await loadCompany(c.id));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const field = (f: MarketField) => {
    const current = (b.market as any)?.[f.k] as number | null | undefined;
    const origin = b.market?.field_origin?.[f.k];
    const p = parsed[f.k];
    return (
      <div key={f.k} className="input-card">
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontWeight: 500 }}>{f.label}</b>
          {!f.needed && <span className="tag">Optional</span>}
          {current != null && <SourceTag source={origin === "user" ? "user" : "market"} />}
        </div>
        <div className="muted small">{f.where}</div>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            type="text"
            inputMode="decimal"
            aria-label={f.label}
            placeholder={current != null ? showInput(current, f.format) : `e.g. ${f.example}`}
            value={draft[f.k] ?? ""}
            onChange={(e) => { setSaved(null); setDraft((d) => ({ ...d, [f.k]: e.target.value })); }}
            style={{ width: 160 }}
          />
          {current != null && !(f.k in draft) && <span className="muted small">Now: {showInput(current, f.format)}</span>}
        </div>
        {p?.error && <div className="small" style={{ color: "var(--fail)", marginTop: 4 }}>{p.error}</div>}
        <div className="muted small" style={{ marginTop: 4 }}>Used for: {f.usedFor}</div>
      </div>
    );
  };

  return (
    <div className="stack" style={{ maxWidth: 860, paddingBottom: 24 }}>
      <div><Link to={`/c/${c.id}`} className="small">← Back to {c.ticker}</Link></div>
      <h1>Missing numbers for {c.ticker}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {missing.length
          ? `${missing.length} number${missing.length > 1 ? "s" : ""} couldn't be fetched automatically. Each one takes a few seconds to find on Yahoo Finance: open the page, find the row, and paste what you see. Formats like 483.18B or 2.59% are fine.`
          : "Everything the analysis needs is filled in. You can still correct any number below."}
      </p>

      <div className="row">
        <div className="seg" role="group" aria-label="Which numbers">
          <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>Missing ({missing.length})</button>
          <button aria-pressed={showAll} onClick={() => setShowAll(true)}>All numbers</button>
        </div>
        <span className="muted small">Numbers you enter are kept when market data is refreshed.</span>
      </div>

      {saved !== null && (
        <div className="notice row">
          <span style={{ flex: 1 }}>Saved {saved} number{saved === 1 ? "" : "s"}.</span>
          <button className="btn sm primary" onClick={() => nav(`/c/${c.id}`)}>See the updated analysis</button>
        </div>
      )}

      {shown.length === 0 && saved === null && (
        <div className="panel">
          <p style={{ margin: 0 }}>Nothing is missing. <button className="btn ghost sm" onClick={() => setShowAll(true)}>Show all numbers</button></p>
        </div>
      )}

      {PAGE_ORDER.map((page) => {
        const fields = shown.filter((f) => f.page === page);
        if (!fields.length) return null;
        return (
          <section key={page} className="panel stack">
            <div className="row">
              <h3 style={{ flex: 1 }}>Yahoo Finance: {PAGE_NAME[page]} page{page === "spx" ? "" : ` for ${sym}`}</h3>
              <a className="btn sm" href={yahooUrl(sym, page)} target="_blank" rel="noreferrer">Open on Yahoo Finance</a>
            </div>
            <div className="input-grid">{fields.map(field)}</div>
          </section>
        );
      })}

      {err && <div className="notice error">{err}</div>}

      {(Object.keys(draft).length > 0) && (
        <div className="savebar">
          <span className="muted small" style={{ flex: 1 }}>
            {`${changes.length} number${changes.length === 1 ? "" : "s"} ready to save.`}
            {hasErrors && " Entries marked in red won't be saved until they're fixed."}
          </span>
          <button className="btn ghost" onClick={() => setDraft({})} disabled={busy}>Clear</button>
          <button className="btn primary" onClick={save} disabled={busy || !changes.length}>{busy ? "Saving…" : `Save ${changes.length || ""} number${changes.length === 1 ? "" : "s"}`}</button>
        </div>
      )}
    </div>
  );
}
