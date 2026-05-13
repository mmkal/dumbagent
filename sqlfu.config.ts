import { defineConfig } from "sqlfu";

export default defineConfig({
  db: "./.sqlfu/app.db",
  definitions: "./db/definitions.sql",
  queries: "./db/sql",
  generate: {
    importExtension: ".ts",
    sync: true,
  },
});
