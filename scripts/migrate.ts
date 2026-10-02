import { openDb, migrate } from "../src/lib/db";
import { config } from "../src/lib/config";

const db = openDb(config.databasePath);
const applied = migrate(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
