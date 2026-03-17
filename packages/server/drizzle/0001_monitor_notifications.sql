CREATE TABLE `monitor_events` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitor_events_source_key_unique` ON `monitor_events` (`source_key`);
--> statement-breakpoint
CREATE TABLE `monitor_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_event_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`monitor_event_id`) REFERENCES `monitor_events`(`id`) ON UPDATE no action ON DELETE no action
);
