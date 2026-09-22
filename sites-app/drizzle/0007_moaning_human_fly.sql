CREATE TABLE `request_rate_limits` (
	`counter_key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_request_rate_limits_expires_at` ON `request_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scaling_build_results` (
	`build_key` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`completed_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scaling_build_results_expires_at` ON `scaling_build_results` (`expires_at`);