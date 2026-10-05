"use client";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { ActionButton } from "./forms";

export function SafetyAck({ at }: { at: string | null }) {
  return at ? (
    <p className="notice good" role="status">You acknowledged these rules on {formatLocal(at, "America/Toronto")}.</p>
  ) : (
    <div className="notice warn">
      <p><b>Volunteers must acknowledge these rules before their first assignment.</b> Your acknowledgement is saved with the date and time.</p>
      <p style={{ marginBottom: 0 }}><ActionButton label="I have read these rules and will follow them" className="btn" action={() => api("POST", "/api/safety/ack")} /></p>
    </div>
  );
}
