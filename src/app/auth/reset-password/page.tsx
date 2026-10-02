import { ResetPasswordForm } from "@/components/AuthForms";
export const metadata = { title: "Reset password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="narrow">
      <h1>Choose a new password</h1>
      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
