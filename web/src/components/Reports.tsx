import { useState } from "react";
import type { Market } from "../engine/types";
import { money, num, pct } from "../engine/format";
import { deleteDocument, extractDocument, openPdf, refreshMarket, saveMarketField, updateCompany, updateDocument, uploadDocument, type Company, type Doc } from "../lib/api";
import { guessKind } from "../lib/pdf";
import { SourceTag } from "./Assessment";

const KINDS: [Doc["kind"], string][] = [
  ["annual", "Annual report / 10-K"],
  ["quarterly", "Quarterly report / 10-Q"],
  ["transcript", "Earnings call transcript"],
  ["other", "Other"],
];

interface Pending {
  file: File;
  kind: Doc["kind"];
  stage: string;
  error?: string;
  done?: boolean;
}

export function Reports({ company, docs, model, onChanged }: { company: Company; docs: Doc[]; model?: string; onChanged: () => void }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const pdfs = [...files].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setQueue((q) => [...q.filter((x) => !x.done), ...pdfs.map((f) => ({ file: f, kind: guessKind(f.name), stage: "Ready" }))]);
  }

  async function processAll() {
    setRunning(true);
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.done) continue;
      const set = (patch: Partial<Pending>) => setQueue((q) => q.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      try {
        const doc = await uploadDocument(company, item.file, item.kind, (s) => set({ stage: s, error: undefined }));
        onChanged();
        if (item.kind === "annual" || item.kind === "quarterly") {
          set({ stage: "Claude is reading the financial statements…" });
          const r = await extractDocument(doc.id, model);
          set({ stage: `Done: ${r.rows} figures read${r.warnings?.length ? `, ${r.warnings.length} notes` : ""}`, done: true });
        } else {
          set({ stage: "Saved. Claude uses it when drafting judgments.", done: true });
        }
      } catch (e: any) {
        set({ stage: "Failed", error: e.message });
      }
      onChanged();
    }
    setRunning(false);
  }

  async function reread(d: Doc) {
    setBusyDoc(d.id);
    setErr(null);
    try {
      await extractDocument(d.id, model);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusyDoc(null);
    onChanged();
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete ${d.filename}? Figures Claude read from it are removed too; numbers you entered stay.`)) return;
    setBusyDoc(d.id);
    try {
      await deleteDocument(d, true);
    } catch (e: any) {
      setErr(e.message);
    }
    setBusyDoc(null);
    onChanged();
  }

  const unread = docs.filter((d) => (d.kind === "annual" || d.kind === "quarterly") && (d.extract_status === "pending" || d.extract_status === "error"));
  const [bulk, setBulk] = useState<string | null>(null);
  const readable = docs.filter((d) => d.kind === "annual" || d.kind === "quarterly");
  async function readAll(list: Doc[]) {
    setErr(null);
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBulk(`Reading ${i + 1} of ${list.length}: ${list[i].filename}…`);
      try {
        await extractDocument(list[i].id, model);
      } catch (e: any) {
        errors.push(`${list[i].filename}: ${e.message}`);
        if (/API key|workspace|credit|authentication/i.test(e.message)) break; // same error for every file
      }
      onChanged();
    }
    setBulk(null);
    if (errors.length) setErr(errors.join(" "));
  }

  const annual = docs.filter((d) => d.kind === "annual").length;
  const quarterly = docs.filter((d) => d.kind === "quarterly").length;

  return (
    <div className="stack">
      <div className="panel stack">
        <h3>Reports</h3>
        <p className="muted small" style={{ margin: 0 }}>
          For a full five-year history and the 4–6 quarter checks, upload the last 3 annual reports and the last 4 quarterly reports. You have {annual} annual and {quarterly} quarterly.
          Earnings call transcripts help Claude judge management. Text-based PDFs only; scanned images can't be read.
        </p>
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          Drop PDFs here, or{" "}
          <label style={{ color: "var(--green)", cursor: "pointer", textDecoration: "underline" }}>
            choose files
            <input type="file" accept="application/pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {queue.length > 0 && (
          <div className="stack">
            {queue.map((q, i) => (
              <div className="row" key={i}>
                <span style={{ flex: "1 1 220px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{q.file.name}</span>
                <select value={q.kind} disabled={running || q.done || q.stage !== "Ready"} onChange={(e) => setQueue((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value as Doc["kind"] } : y)))}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span className={`small ${q.error ? "" : "muted"}`} style={{ flex: "1 1 240px", color: q.error ? "var(--fail)" : undefined }}>{q.error ?? q.stage}</span>
              </div>
            ))}
            <div className="row">
              <button className="btn primary" onClick={processAll} disabled={running || queue.every((q) => q.done)}>{running ? "Working…" : "Upload and read"}</button>
              {!running && <button className="btn ghost" onClick={() => setQueue([])}>Clear list</button>}
            </div>
          </div>
        )}
      </div>

      {err && <div className="notice error">{err}</div>}

      {unread.length > 0 ? (
        <div className="row notice">
          <span style={{ flex: 1 }}>{bulk ?? `${unread.length} report${unread.length > 1 ? "s haven't" : " hasn't"} been read yet.`}</span>
          <button className="btn primary sm" disabled={!!bulk || running} onClick={() => readAll(unread)}>Read numbers from all of them</button>
        </div>
      ) : readable.length > 0 && (
        <div className="row">
          <span className="muted small" style={{ flex: 1 }}>{bulk ?? "Numbers you typed in yourself are kept when reports are read again."}</span>
          <button className="btn sm" disabled={!!bulk || running} onClick={() => readAll(readable)}>Read all {readable.length} reports again</button>
        </div>
      )}

      {docs.length > 0 && (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="co-table">
            <thead><tr><th>Report</th><th>Type</th><th>Period</th><th>Numbers</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} style={{ cursor: "default" }}>
                  <td>
                    <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => openPdf(d)}>{d.filename}</button>
                    <div className="muted small">{d.page_count} pages</div>
                  </td>
                  <td>
                    <select value={d.kind} onChange={async (e) => { await updateDocument(d.id, { kind: e.target.value as Doc["kind"] }); onChanged(); }}>
                      {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                  <td>{d.fiscal_label ?? "—"}<div className="muted small">{d.period_end ?? ""}</div></td>
                  <td className="small">
                    {d.extract_status === "done" && <span className="tag user">Read</span>}
                    {d.extract_status === "running" && <span className="tag ai">Reading…</span>}
                    {d.extract_status === "pending" && <span className="tag">Not read yet</span>}
                    {d.extract_status === "skipped" && <span className="tag">Text only</span>}
                    {d.extract_status === "error" && <span className="tag kill">Failed</span>}
                    {d.extract_error && <div className="muted" style={{ maxWidth: 320, whiteSpace: "normal" }}>{d.extract_error}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {(d.kind === "annual" || d.kind === "quarterly") && (
                      <button className="btn sm" disabled={busyDoc === d.id} onClick={() => reread(d)}>{busyDoc === d.id ? "Reading…" : d.extract_status === "done" ? "Read again" : "Read numbers"}</button>
                    )}{" "}
                    <button className="btn ghost sm danger" disabled={busyDoc === d.id} onClick={() => remove(d)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MARKET_FIELDS: { k: keyof Market & string; label: string; fmt: (v: number | null | undefined) => string; unit?: string; help?: string }[] = [
  { k: "price", label: "Share price", fmt: (v) => money(v) },
  { k: "market_cap", label: "Market cap", fmt: (v) => money(v), unit: "dollars" },
  { k: "shares_outstanding", label: "Shares outstanding", fmt: (v) => num(v, 0) },
  { k: "forward_pe", label: "Forward P/E", fmt: (v) => num(v, 1) },
  { k: "peg", label: "PEG", fmt: (v) => num(v, 2) },
  { k: "short_interest_pct", label: "Short interest (% of float)", fmt: (v) => pct(v) },
  { k: "institutional_pct", label: "Institutional ownership (%)", fmt: (v) => pct(v) },
  { k: "return_5y_pct", label: "5-year total return (%)", fmt: (v) => pct(v, 0) },
  { k: "spx_return_5y_pct", label: "S&P 500 5-year return (%)", fmt: (v) => pct(v, 0) },
  { k: "earnings_misses_last4", label: "EPS misses, last 4 quarters", fmt: (v) => num(v, 0) },
];

export function MarketPanel({ company, market, onChanged }: { company: Company; market: Market | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [symbol, setSymbol] = useState(company.data_symbol ?? "");

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await refreshMarket(company.id);
      const from = r.sources?.length ? ` from ${r.sources.join(" and ")}` : "";
      setMsg({ text: [`Updated ${r.updated.length} fields${from}.`, ...r.warnings].join(" "), error: r.updated.length === 0 && r.warnings.length > 0 });
    } catch (e: any) {
      setMsg({ error: true, text: e.message });
    }
    setBusy(false);
    onChanged();
  }

  async function save(k: string) {
    const v = draft.trim() === "" ? null : Number(draft.replace(/,/g, ""));
    if (v !== null && !Number.isFinite(v)) return;
    await saveMarketField(company.id, k, v, market);
    setEditing(null);
    onChanged();
  }

  return (
    <div className="panel stack">
      <div className="row">
        <h3>Market data</h3>
        <span className="spacer" />
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center", gap: 8 }}>
          Symbol
          <input type="text" value={symbol} placeholder={company.ticker} style={{ width: 110 }} onChange={(e) => setSymbol(e.target.value)}
            onBlur={async () => { if ((company.data_symbol ?? "") !== symbol) { await updateCompany(company.id, { data_symbol: symbol.trim().toUpperCase() || null }); onChanged(); } }} />
        </label>
        <button className="btn" onClick={refresh} disabled={busy}>{busy ? "Fetching…" : "Refresh market data"}</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        From Yahoo Finance, with Alpha Vantage as a backup. Numbers you type are kept on refresh. For Toronto listings set the symbol to e.g. SHOP.TO.
        {market?.fetched_at && ` Last fetched ${new Date(market.fetched_at).toLocaleString()}.`}{" "}
        <a href={`https://seekingalpha.com/symbol/${company.ticker}`} target="_blank" rel="noreferrer">Seeking Alpha</a>
        {" · "}
        <a href={`https://finance.yahoo.com/quote/${company.ticker}/holders`} target="_blank" rel="noreferrer">Yahoo holders</a>
      </p>
      {msg && <div className={`notice ${msg.error ? "error" : ""}`}>{msg.text}</div>}
      <div className="grid-2">
        {MARKET_FIELDS.map((f) => {
          const v = (market as any)?.[f.k] as number | null | undefined;
          const origin = market?.field_origin?.[f.k];
          return (
            <div key={f.k} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="muted small">{f.label}</span>
                <SourceTag source={origin === "user" ? "user" : origin === "api" ? "market" : null} />
              </div>
              {editing === f.k ? (
                <div className="row" style={{ gap: 6 }}>
                  <input autoFocus type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(f.k); if (e.key === "Escape") setEditing(null); }} style={{ width: 140 }} />
                  <button className="btn sm" onClick={() => save(f.k)}>Save</button>
                </div>
              ) : (
                <button className="btn ghost" style={{ padding: "2px 0", fontSize: 18 }} onClick={() => { setEditing(f.k); setDraft(v === null || v === undefined ? "" : String(v)); }}>
                  {v === null || v === undefined ? <span className="muted small">Add</span> : f.fmt(v)}
                </button>
              )}
              {f.help && <div className="muted small">{f.help}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
