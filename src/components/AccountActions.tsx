"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function DeleteAccount() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api("DELETE", "/api/account", { confirm: text });
          router.push("/");
          router.refresh();
        } catch (err) { setError((err as Error).message); }
      }}
    >
      <label htmlFor="del">Type DELETE to confirm</label>
      <input id="del" type="text" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p><button className="btn danger" disabled={text !== "DELETE"}>Delete my account permanently</button></p>
    </form>
  );
}
