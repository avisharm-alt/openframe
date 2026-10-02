"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="link-btn"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className="btn"
        style={{ fontSize: "1rem", padding: "0.55rem 1.4rem" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          // On success the browser is redirected to Google; on failure we stay here.
          const res = await authClient.signIn.social({
            provider: "google",
            callbackURL: "/",
            newUserCallbackURL: "/account?welcome=1",
            errorCallbackURL: "/auth/sign-in?error=oauth",
          });
          if (res?.error) {
            setError(res.error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Could not start Google sign-in. Please try again.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Redirecting to Google…" : "Continue with Google"}
      </button>
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
  );
}

/** Demo mode only: email+password so the seeded demo accounts and automated tests can sign in without Google. */
export function DemoPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await authClient.signIn.email({ email: String(f.get("email")).trim(), password: String(f.get("password")) });
      if (res.error) {
        setError(res.error.status === 429 ? "Too many attempts. Please wait and try again." : "That email and password did not match.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="card" aria-describedby={error ? "demo-error" : undefined}>
      <label htmlFor="email" style={{ marginTop: 0 }}>Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" required autoComplete="current-password" />
      {error && <p id="demo-error" role="alert" className="field-error">{error}</p>}
      <p><button className="btn secondary" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button></p>
    </form>
  );
}

export function DisplayNameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        const res = await authClient.updateUser({ name: name.trim() });
        if (res.error) setMsg({ ok: false, text: res.error.message || "Could not save that name." });
        else {
          setMsg({ ok: true, text: "Saved." });
          router.refresh();
        }
      }}
    >
      <label htmlFor="dn" style={{ marginTop: 0 }}>Display name <span className="help">A pseudonym is best: it appears to reviewers, and publicly only if you choose attribution on a contribution. Please don’t use your real name or student number.</span></label>
      <input id="dn" type="text" value={name} minLength={2} maxLength={40} required onChange={(e) => setName(e.target.value)} />
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "small" : "field-error"}>{msg.text}</p>}
      <p><button className="btn secondary">Save display name</button></p>
    </form>
  );
}
