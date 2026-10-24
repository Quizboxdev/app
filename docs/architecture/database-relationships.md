# Database entity map (selected, from migrations and tests)

Not exhaustive: 98 public tables exist. Relationships below are the ones the application relies on; foreign keys were not individually verified against a live database.

```mermaid
erDiagram
  profiles ||--o| student_profiles : "user_id"
  profiles ||--o{ classes : "teacher_user_id"
  classes ||--o{ class_memberships : has
  institutions ||--o{ institution_memberships : has
  institutions ||--o{ classes : owns
  questions ||--o{ assessment_questions : used_in
  assessments ||--o{ assessment_questions : has
  assessments ||--o{ attempts : taken
  attempts ||--o{ responses : has
  challenge_campaigns ||--o{ challenge_stages : rounds
  challenge_campaigns ||--o{ challenge_questions : has
  challenge_campaigns ||--o{ challenge_participants : joined
  challenge_campaigns ||--o{ challenge_content_assets : material
  challenge_campaigns ||--o{ challenge_prizes : prizes
  profiles ||--o{ activity_drafts : saves
  profiles ||--o| wallets : owns
  wallets ||--o{ coin_transactions : ledger
  profiles ||--o{ payment_intents : pays
  payment_intents ||--o{ payment_events : verified_by
  profiles ||--o{ access_entitlements : granted
  price_list }o--|| platform_settings : "unit price (coins.unit_price_minor)"
```

Curriculum hierarchy: `curriculum_authorities` > curricula (per market and level) > `curriculum_nodes` (strand, sub-strand, indicator; unique on curriculum and identity key) > questions mapped to indicators.
