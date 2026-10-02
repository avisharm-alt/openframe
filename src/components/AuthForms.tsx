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

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signUp = mode === "sign-up";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    try {
      const res = signUp
        ? await authClient.signUp.email({ email, password, name: String(f.get("name") || "Anonymous student").trim() })
        : await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.status === 429 ? "Too many attempts. Please wait and try again." : res.error.message || "That did not work. Check your details and try again.");
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
    <form onSubmit={onSubmit} className="card" aria-describedby={error ? "auth-error" : undefined} noValidate={false}>
      {signUp && (
        <>
          <label htmlFor="name">Display name (a pseudonym is fine)</label>
          <input id="name" name="name" type="text" required maxLength={40} autoComplete="nickname" />
          <span className="help">Shown only if you choose public attribution on a contribution. Do not use your student number.</span>
        </>
      )}
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password {signUp && <span className="help">At least 10 characters.</span>}</label>
      <input id="password" name="password" type="password" required minLength={signUp ? 10 : 1} autoComplete={signUp ? "new-password" : "current-password"} />
      {error && <p id="auth-error" role="alert" className="field-error">{error}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" disabled={busy}>{busy ? "Please wait…" : signUp ? "Create account" : "Sign in"}</button>
        <Link href={signUp ? "/auth/sign-in" : "/auth/sign-up"}>{signUp ? "I already have an account" : "Create an account"}</Link>
      </div>
      {signUp && <p className="small muted">We collect only your email, a display name and your password hash. See the <Link href="/privacy">privacy page</Link>.</p>}
    </form>
  );
}
