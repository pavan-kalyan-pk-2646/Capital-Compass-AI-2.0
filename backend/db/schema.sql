-- Capital Compass AI 2.0 — MySQL 8 schema (generated from models/__init__.py).
-- The app creates these tables automatically on start; run this only to provision by hand:
--   mysql -u root -p capital_compass < db/schema.sql

SET FOREIGN_KEY_CHECKS = 0;


CREATE TABLE `agent_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `decision_id` varchar(36) NOT NULL,
  `round` int(11) NOT NULL,
  `agent_name` varchar(40) NOT NULL,
  `decision` varchar(255) NOT NULL,
  `stance` varchar(16) NOT NULL,
  `reasoning_summary` text NOT NULL,
  `timestamp` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_agent_logs_decision_id` (`decision_id`),
  CONSTRAINT `agent_logs_ibfk_1` FOREIGN KEY (`decision_id`) REFERENCES `decisions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `assets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `profile_id` int(11) NOT NULL,
  `type` varchar(32) NOT NULL,
  `name` varchar(80) NOT NULL,
  `value` decimal(14,2) NOT NULL,
  `risk` varchar(16) NOT NULL,
  `liquidity` varchar(16) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `ix_assets_profile_id` (`profile_id`),
  CONSTRAINT `assets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `assets_ibfk_2` FOREIGN KEY (`profile_id`) REFERENCES `financial_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `audit_trail` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `decision_id` varchar(36) NOT NULL,
  `seq` int(11) NOT NULL,
  `node_name` varchar(40) NOT NULL,
  `status` varchar(16) NOT NULL,
  `message` text NOT NULL,
  `duration_ms` int(11) NOT NULL,
  `timestamp` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_audit_trail_decision_id` (`decision_id`),
  CONSTRAINT `audit_trail_ibfk_1` FOREIGN KEY (`decision_id`) REFERENCES `decisions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `decisions` (
  `id` varchar(36) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `guest_key` varchar(64) DEFAULT NULL,
  `type` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL,
  `command` text NOT NULL,
  `input_data` JSON NOT NULL,
  `recommendation` JSON DEFAULT NULL,
  `result` JSON DEFAULT NULL,
  `confidence` decimal(5,4) DEFAULT NULL,
  `error` text DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_decisions_guest_key` (`guest_key`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `decisions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `financial_profiles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `guest_key` varchar(64) DEFAULT NULL,
  `name` varchar(80) NOT NULL,
  `age` int(11) NOT NULL,
  `income` decimal(14,2) NOT NULL,
  `expenses` decimal(14,2) NOT NULL,
  `investment` decimal(14,2) NOT NULL,
  `savings` decimal(14,2) NOT NULL,
  `emergency_fund` decimal(14,2) NOT NULL,
  `stability` varchar(32) NOT NULL,
  `risk` decimal(5,2) NOT NULL,
  `data` JSON NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_financial_profiles_guest_key` (`guest_key`),
  KEY `ix_financial_profiles_user_id` (`user_id`),
  CONSTRAINT `financial_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `goals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `guest_key` varchar(64) DEFAULT NULL,
  `profile_id` int(11) DEFAULT NULL,
  `name` varchar(80) NOT NULL,
  `target_amount` decimal(14,2) NOT NULL,
  `current_amount` decimal(14,2) NOT NULL,
  `target_date` datetime NOT NULL,
  `priority` varchar(16) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_goals_guest_key` (`guest_key`),
  KEY `user_id` (`user_id`),
  KEY `ix_goals_profile_id` (`profile_id`),
  CONSTRAINT `goals_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `goals_ibfk_2` FOREIGN KEY (`profile_id`) REFERENCES `financial_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `liabilities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `profile_id` int(11) NOT NULL,
  `type` varchar(32) NOT NULL,
  `principal` decimal(14,2) NOT NULL,
  `interest_rate` decimal(6,3) NOT NULL,
  `tenure` int(11) NOT NULL,
  `emi` decimal(14,2) NOT NULL,
  `remaining_amount` decimal(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `ix_liabilities_profile_id` (`profile_id`),
  CONSTRAINT `liabilities_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `liabilities_ibfk_2` FOREIGN KEY (`profile_id`) REFERENCES `financial_profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `loans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `type` varchar(32) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `interest_rate` decimal(6,3) NOT NULL,
  `tenure` int(11) NOT NULL,
  `fee` decimal(14,2) NOT NULL,
  `emi` decimal(14,2) NOT NULL,
  `total_interest` decimal(14,2) NOT NULL,
  `risk_score` decimal(5,1) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `loans_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `portfolio_holdings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `portfolio_id` int(11) NOT NULL,
  `asset` varchar(80) NOT NULL,
  `type` varchar(32) NOT NULL,
  `sector` varchar(40) NOT NULL,
  `value` decimal(14,2) NOT NULL,
  `weight` decimal(7,4) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_portfolio_holdings_portfolio_id` (`portfolio_id`),
  CONSTRAINT `portfolio_holdings_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `portfolios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `name` varchar(80) NOT NULL,
  `total_value` decimal(14,2) NOT NULL,
  `risk_score` decimal(6,2) NOT NULL,
  `health_score` decimal(5,1) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `portfolios_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `simulations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `type` varchar(32) NOT NULL,
  `parameters` JSON NOT NULL,
  `results` JSON NOT NULL,
  `scenario_count` int(11) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `simulations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `email` varchar(254) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
