CREATE TABLE `monitor_pr_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_title` text NOT NULL,
	`pr_url` text NOT NULL,
	`head_sha` text NOT NULL,
	`mergeable_state` text,
	`checks_state` text NOT NULL,
	`latest_external_comment_id` text,
	`latest_external_comment_author_login` text,
	`latest_external_comment_body` text,
	`latest_external_comment_url` text,
	`latest_external_comment_created_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE no action
);
