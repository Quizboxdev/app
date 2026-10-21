-- Rollback for 20261033100000_drop_stale_practice_overloads.sql. The dropped copies were superseded and caused the failure, so restoring them is not advised.
-- If ever needed, re-apply the original definitions from 20261012200000_quick_practice.sql (qb_practice_menu() and qb_start_quick_practice(uuid[], integer)).
select 1;
