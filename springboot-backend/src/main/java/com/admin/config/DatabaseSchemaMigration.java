package com.admin.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Applies small, backwards-compatible schema fixes required by application updates.
 *
 * <p>The original group_link table did not contain the common BaseEntity timestamp
 * columns. Existing installations therefore need the same fix as fresh installs.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DatabaseSchemaMigration implements ApplicationRunner {

    private static final String GROUP_LINK_TABLE = "group_link";

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        ensureColumn("created_time",
                "ALTER TABLE `group_link` ADD COLUMN `created_time` BIGINT(20) NOT NULL DEFAULT 0 AFTER `inx`");
        ensureColumn("updated_time",
                "ALTER TABLE `group_link` ADD COLUMN `updated_time` BIGINT(20) NOT NULL DEFAULT 0 AFTER `created_time`");

        long now = System.currentTimeMillis();
        jdbcTemplate.update("UPDATE `group_link` SET `created_time` = ? WHERE `created_time` = 0", now);
        jdbcTemplate.update("UPDATE `group_link` SET `updated_time` = `created_time` WHERE `updated_time` = 0");
    }

    private void ensureColumn(String columnName, String alterSql) {
        if (columnExists(columnName)) {
            return;
        }

        try {
            jdbcTemplate.execute(alterSql);
            log.info("Database migration added {}.{}", GROUP_LINK_TABLE, columnName);
        } catch (DataAccessException ex) {
            // Another instance may have completed the same idempotent migration.
            if (!columnExists(columnName)) {
                throw ex;
            }
        }
    }

    private boolean columnExists(String columnName) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class,
                GROUP_LINK_TABLE,
                columnName);
        return count != null && count > 0;
    }
}
