import { redirect } from "next/navigation";
import { config } from "@/lib/config";

export default function Contribute() {
  redirect(config.notesUploadsEnabled ? "/course-notes" : "/guidelines");
}
