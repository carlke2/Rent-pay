import "server-only";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** uuid primary key used by every table. */
export const id = () => uuid("id").primaryKey().defaultRandom();

/** created_at used by every table. */
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
