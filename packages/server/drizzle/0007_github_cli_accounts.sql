ALTER TABLE `github_accounts` ADD COLUMN `hostname` text NOT NULL DEFAULT 'github.com';
--> statement-breakpoint
ALTER TABLE `github_accounts` ADD COLUMN `token_source` text NOT NULL DEFAULT 'gh-cli';
--> statement-breakpoint
UPDATE `github_accounts` SET `access_token` = '';
