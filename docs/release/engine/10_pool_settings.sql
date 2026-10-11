-- Change the SME pool limits. Edit the number, then run (the SQL editor runs as the database owner).
-- Defaults: pick_size 25, daily_cap 100, max_open 50, release_hours 24. Run one statement at a time.
update quizbox_sme.pool_settings set value = 100, updated_at = now() where key = 'daily_cap';
-- update quizbox_sme.pool_settings set value = 25, updated_at = now() where key = 'pick_size';
-- update quizbox_sme.pool_settings set value = 50, updated_at = now() where key = 'max_open';
-- update quizbox_sme.pool_settings set value = 24, updated_at = now() where key = 'release_hours';
