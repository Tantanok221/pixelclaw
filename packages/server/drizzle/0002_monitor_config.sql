CREATE TABLE `github_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_user_id` text NOT NULL,
	`login` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`access_token` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`github_account_id` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`poll_interval_seconds` integer NOT NULL,
	`next_poll_at` text NOT NULL,
	`last_polled_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`github_account_id`) REFERENCES `github_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
