import { DemoPasswordForm, GoogleButton } from "@/components/AuthForms";
import { config } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const failed = (await searchParams).error;
  return (
    <div style={{ maxWidth: "34rem" }}>
      <h1>Sign in</h1>
      <p className="muted">
        Signing in saves your practice history across devices and lets you bookmark and contribute questions. Browsing and practising never require an account.
      </p>
      {failed && (
        <p className="notice bad" role="alert">
          Google sign-in did not complete. You may have cancelled, or something went wrong. Please try again.
        </p>
      )}
      {config.googleEnabled ? (
        <>
          <GoogleButton />
          <p className="small muted">
            We use Google only to confirm your email address. We keep your email, not your Google name or photo, and you get a random display name you can change. We never post
            anything to your Google account. See the <a href="/privacy">privacy page</a>.
          </p>
        </>
      ) : (
        !config.demo && <p className="notice warn" role="status">Sign-in has not been set up on this site yet. You can still browse and practise as a guest.</p>
      )}
      {config.passwordLoginEnabled && (
        <>
          <h2>Demo accounts</h2>
          <p className="small muted">Demo mode only: email and password sign-in for the seeded demo accounts (see the README). This does not exist in production.</p>
          <DemoPasswordForm />
        </>
      )}
    </div>
  );
}
