CREATE TABLE IF NOT EXISTS `relays` (
	`id` VARCHAR(64) PRIMARY KEY,
	`modes` JSON,
	`whook_url` TEXT
);

CREATE TABLE IF NOT EXISTS `webhooks` (
  `token` varchar(128) PRIMARY KEY,
  `id` varchar(64),
  `url` varchar(192),
  `channel` varchar(128)
);