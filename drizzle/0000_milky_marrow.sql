CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`size` integer,
	`storage_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_email` ON `attachments` (`email_id`);--> statement-breakpoint
CREATE TABLE `email_types` (
	`id` text PRIMARY KEY NOT NULL,
	`email_prefix` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_types_email_prefix_unique` ON `email_types` (`email_prefix`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text,
	`received_at` text NOT NULL,
	`storage_prefix` text NOT NULL,
	`raw_size` integer,
	`status` text DEFAULT 'received' NOT NULL,
	`error_message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `email_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_emails_type` ON `emails` (`type_id`);--> statement-breakpoint
CREATE INDEX `idx_emails_received` ON `emails` (`received_at`);--> statement-breakpoint
CREATE INDEX `idx_emails_status` ON `emails` (`status`);