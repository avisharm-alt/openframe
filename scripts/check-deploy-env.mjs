// Fail fast if the single-server deployment still has example or unsafe values.
import path from "node:path";

const errors = [];
const origin = process.env.BASE_URL || "";
try {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || /(^|\.)example\.(org|com|net)$/.test(url.hostname) || url.hostname === "localhost") {
    errors.push("BASE_URL must be the exact public HTTPS origin, with the example hostname replaced");
  }
} catch {
  errors.push("BASE_URL must be a valid public HTTPS origin");
}
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32 || /^(replace|change|example)/i.test(process.env.AUTH_SECRET)) {
  errors.push("AUTH_SECRET must be a new random string of at least 32 characters");
}
if (!path.isAbsolute(process.env.DATABASE_PATH || "")) errors.push("DATABASE_PATH must be an absolute persistent path");
if (!path.isAbsolute(process.env.BACKUP_DIRECTORY || "")) errors.push("BACKUP_DIRECTORY must be an absolute persistent path");
if (process.env.OPENFRAME_DEMO === "1" || process.env.OPENFRAME_DEMO === "true") errors.push("OPENFRAME_DEMO must be disabled");
if (process.env.NODE_ENV !== "production") errors.push("NODE_ENV must be production");

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Deployment environment check passed.");
