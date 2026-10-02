"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

const domainText = (d: string[]) => d.map((x) => `@${x}`).join(" or ");

export function AuthForm({ mode, allowedDomains }: { mode: "sign-in" | "sign-up"; allowedDomains: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const signUp = mode === "sign-up";
  const restricted = allowedDomains.length > 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password"));
    setBusy(true);
    try {
      const res = signUp
        ? await authClient.signUp.email({ email, password, name: String(f.get("name") || "Anonymous student").trim(), callbackURL: "/" })
        : await authClient.signIn.email({ email, password });
      if (res.error) {
        if (res.error.status === 429) setError("Too many attempts. Please wait and try again.");
        else if (res.error.status === 403) { setSent(email); setError(null); }
        else setError(res.error.message || "That did not work. Check your details and try again.");
        return;
      }
      if (signUp && restricted) {
        setSent(email);
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

  if (sent) {
    return (
      <div className="notice good" role="status">
        <p><b>Check your email.</b> We sent a confirmation link to <b>{sent}</b>. Open it to finish {signUp ? "creating your account" : "signing in"}. The link expires in 24 hours.</p>
        <p className="small">Nothing there? Check spam, then <Link href="/auth/sign-in">try signing in</Link> to get a fresh link.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card" aria-describedby={error ? "auth-error" : undefined}>
      {restricted && <p className="notice" role="note" style={{ marginTop: 0 }}>For now, accounts are limited to {domainText(allowedDomains)} email addresses. Browsing and practising never need an account.</p>}
      {signUp && (
        <>
          <label htmlFor="name">Display name (a pseudonym is fine)</label>
          <input id="name" name="name" type="text" required maxLength={40} autoComplete="nickname" />
          <span className="help">Shown only if you choose public attribution on a contribution. Do not use your student number.</span>
        </>
      )}
      <label htmlFor="email">{restricted ? `University email (${domainText(allowedDomains)})` : "Email"}</label>
      <input id="email" name="email" type="email" required autoComplete="email" placeholder={restricted ? `username@${allowedDomains[0]}` : undefined} />
      <label htmlFor="password">Password {signUp && <span className="help">At least 10 characters.</span>}</label>
      <input id="password" name="password" type="password" required minLength={signUp ? 10 : 1} autoComplete={signUp ? "new-password" : "current-password"} />
      {error && <p id="auth-error" role="alert" className="field-error">{error}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : signUp ? "Create account" : "Sign in"}</button>
        <Link href={signUp ? "/auth/sign-in" : "/auth/sign-up"}>{signUp ? "I already have an account" : "Create an account"}</Link>
        {!signUp && <Link href="/auth/forgot-password">Forgot password?</Link>}
      </div>
      {signUp && <p className="small muted">We collect only your email, a display name and your password hash. See the <Link href="/privacy">privacy page</Link>.</p>}
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return <p className="notice good" role="status">If an account exists for that address, we have sent a reset link. It expires in one hour.</p>;
  }
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const r = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/auth/reset-password" });
        if (r.error && r.error.status === 429) setError("Too many requests. Please wait and try again.");
        else setDone(true); // same answer whether or not the account exists
      }}
    >
      <label htmlFor="fp-email">Email</label>
      <input id="fp-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p><button className="btn">Send reset link</button></p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!token) return <p className="notice bad" role="alert">This reset link is missing or invalid. <Link href="/auth/forgot-password">Request a new one</Link>.</p>;
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const pw = String(new FormData(e.currentTarget).get("password"));
        const r = await authClient.resetPassword({ newPassword: pw, token });
        if (r.error) setError(r.error.message || "This link is invalid or has expired. Request a new one.");
        else router.push("/auth/sign-in");
      }}
    >
      <label htmlFor="np">New password <span className="help">At least 10 characters.</span></label>
      <input id="np" name="password" type="password" required minLength={10} autoComplete="new-password" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p><button className="btn">Set new password</button></p>
    </form>
  );
}
