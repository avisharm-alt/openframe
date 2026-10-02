import { AuthForm } from "@/components/AuthForms";
import { config } from "@/lib/config";
export const metadata = { title: "Create account" };
export default function Page() {
  return (
    <div style={{ maxWidth: "30rem" }}>
      <h1>Create an account</h1>
      <p className="muted">Free, with no ads and no data sales. {config.requireEmailVerification ? "We’ll email you a link to confirm your address." : "Email verification is not enabled on this instance."}</p>
      <AuthForm mode="sign-up" allowedDomains={config.allowedEmailDomains} />
    </div>
  );
}
