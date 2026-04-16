import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const emailTypes = sqliteTable("email_types", {
  id: text("id").primaryKey(),
  emailPrefix: text("email_prefix").unique().notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  active: integer("active").default(1).notNull(),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => emailTypes.id),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    receivedAt: text("received_at").notNull(),
    storagePrefix: text("storage_prefix").notNull(),
    rawSize: integer("raw_size"),
    status: text("status").default("received").notNull(),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [
    index("idx_emails_type").on(table.typeId),
    index("idx_emails_received").on(table.receivedAt),
    index("idx_emails_status").on(table.status),
  ]
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    storageKey: text("storage_key").notNull(),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [index("idx_attachments_email").on(table.emailId)]
);
