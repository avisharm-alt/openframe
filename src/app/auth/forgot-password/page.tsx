import { ForgotPasswordForm } from "@/components/AuthForms";
export const metadata = { title: "Forgot password" };
export default function Page() {
  return (
    <div className="narrow">
      <h1>Forgot your password?</h1>
      <p className="muted">Enter the email you signed up with and we’ll send a link to choose a new password.</p>
      <ForgotPasswordForm />
    </div>
  );
}
