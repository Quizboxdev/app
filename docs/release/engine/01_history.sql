-- READ-ONLY. Which migrations the database records. Hand-applied ones will not appear; that is expected.
select version, name from supabase_migrations.schema_migrations order by version desc limit 25;
