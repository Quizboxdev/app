# Rollback for 20261071100000_fix_any_topic_delete
Re-run only the quizbox_topic.blueprint_plan function definition (lines 111-217) from supabase/migrations/20261055100000_assessment_blueprint.sql. That brings back the delete without WHERE, so "Any topic" fails again. Normally you would not roll this back.
