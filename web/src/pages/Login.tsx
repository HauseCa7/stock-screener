import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: error.message });
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      setMsg(error ? { kind: "error", text: error.message } : { kind: "info", text: "Check your email and click the confirmation link, then sign in here." });
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="row" style={{ marginBottom: 20 }}>
        <img src="./favicon.svg" alt="" width={36} height={36} />
        <h1>Island Screener</h1>
      </div>
      <p className="muted">Twelve steps. Fail one, and the company is off the island.</p>
      <form className="panel stack" onSubmit={submit}>
        <label className="field">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="field">Password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
        {msg && <div className={`notice ${msg.kind === "error" ? "error" : ""}`}>{msg.text}</div>}
        <button className="btn primary" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "First time? Create your account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
