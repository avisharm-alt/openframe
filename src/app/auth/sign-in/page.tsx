import { AuthForm } from "@/components/AuthForms";
import { config } from "@/lib/config";
export const metadata = { title: "Sign in" };
export default function Page() {
  return (
    <div className="narrow">
      <h1>Sign in</h1>
      <p className="muted">Signing in saves your practice history across devices and lets you bookmark and contribute questions. Browsing and practising never require an account.</p>
      <AuthForm mode="sign-in" allowedDomains={config.allowedEmailDomains} />
    </div>
  );
}
