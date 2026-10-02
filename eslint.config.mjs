import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "data/**", "backups/**"] },
  // Verification scripts parse loosely-typed JSON from HTTP responses.
  { files: ["scripts/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
];
export default config;
