import fs from "node:fs";
import { openDb, migrate } from "../src/lib/db";
import { config } from "../src/lib/config";
import { importQuestionBank, validateQuestionBank } from "../src/lib/question-bank";

const paths = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
if (!paths.length) throw new Error("Usage: npm run db:import-questions -- [--dry-run] file.json [file.json ...]");
const rows = paths.flatMap((file) => validateQuestionBank(JSON.parse(fs.readFileSync(file, "utf8"))));
validateQuestionBank(rows);
if (process.argv.includes("--dry-run")) {
  console.log(`Validated ${rows.length} questions; database unchanged.`);
} else {
  const db = openDb(config.databasePath);
  try {
    migrate(db);
    console.log(importQuestionBank(db, rows, "The project owner stated they reviewed the supplied questions before requesting publication. This is an owner review statement, not an independent student review."));
  } finally {
    db.close();
  }
}
