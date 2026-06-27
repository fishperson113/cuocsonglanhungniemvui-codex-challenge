import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = new SQLDatabase("better_auth", {
  migrations: "./migrations_auth",
});
