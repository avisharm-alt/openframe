import { AuthForm } from "@/components/AuthForms";
export const metadata = { title: "Create account" };
export default function Page() {
  return (
    <div style={{ maxWidth: "28rem" }}>
      <h1>Create an account</h1>
      <p className="muted">Free, with no ads and no data sales. Email verification is not enabled in this version; use an address you control.</p>
      <AuthForm mode="sign-up" />
    </div>
  );
}
