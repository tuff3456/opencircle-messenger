import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase, usernameToEmail, USERNAME_RE } from "@/lib/db";

export function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [display, setDisplay] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) return setErr("Username: 3–20 characters, letters, numbers or _ only.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    setBusy(true);
    if (mode === "up") {
      const { error } = await supabase.auth.signUp({
        email: usernameToEmail(u), password,
        options: { data: { username: u, display_name: display.trim() || u } },
      });
      if (error) setErr(error.message.includes("registered") ? "That username is taken." : error.message);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(u), password });
      if (error) setErr("Wrong username or password.");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-hero grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="uppercase tracking-[0.3em] text-xs text-primary">Est. 2026</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 leading-tight">Javiers History Project</h1>
          <p className="text-muted-foreground mt-3">Message, call and share with your people.</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6 shadow-glow space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["in", "up"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-md py-2 text-sm font-semibold ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {m === "in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <div className="space-y-2"><Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="javier_1" /></div>
          {mode === "up" && <div className="space-y-2"><Label>Display name</Label>
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="Javier" /></div>}
          <div className="space-y-2"><Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "up" ? "new-password" : "current-password"} /></div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? "…" : mode === "in" ? "Sign in" : "Create account"}</Button>
        </form>
      </div>
    </div>
  );
}
