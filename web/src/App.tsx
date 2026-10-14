import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import CompanyPage from "./pages/Company";
import Companies from "./pages/Companies";
import Login from "./pages/Login";
import MarketInputs from "./pages/MarketInputs";
import Settings from "./pages/Settings";
import Usage from "./pages/Usage";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <HashRouter>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="./favicon.svg" alt="" /> Island Screener
        </NavLink>
        <nav>
          <NavLink to="/" end>Companies</NavLink>
          <NavLink to="/usage">AI usage</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted small hide-sm">{session.user.email}</span>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Companies />} />
          <Route path="/c/:id" element={<CompanyPage />} />
          <Route path="/c/:id/inputs" element={<MarketInputs />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
