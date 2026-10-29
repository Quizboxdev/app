-- Starter rows. Nothing is priced and nothing needs a link yet; change them in Admin, Prices. Safe to run again: existing rows are never overwritten.
insert into public.price_list(code, kind, name, audience, description, includes, period, price_minor, highlight, active, sort_order) values
  ('learner_free', 'plan', 'Free', 'learner', 'Start learning today.', '["Free practice sessions to try QuizBox","Join challenges and competitions","Read the material before you play"]', 'free', 0, false, true, 10),
  ('learner_monthly', 'plan', 'Learner Monthly', 'learner', 'Unlimited practice for a month.', '["Unlimited self-built practice sessions","All subjects for your grade","Progress and mastery tracking"]', 'month', null, false, true, 20),
  ('learner_term', 'plan', 'Learner Term', 'learner', 'The best value for a full school term.', '["Everything in Monthly","Best value for a full school term"]', 'term', null, true, true, 30),
  ('teacher_free', 'plan', 'Teacher', 'teacher', 'Free for teachers.', '["Classes, assignments and gradebook","Question bank","Create up to 3 live quizzes a month"]', 'free', 0, false, true, 10),
  ('school_year', 'plan', 'School', 'school', 'For a whole school.', '["All learners in the school","Teacher assignments and class reports","Challenges and competitions for your school","Contact us for a quote"]', 'year', null, false, true, 20),
  ('sponsor_starter', 'campaign', 'Quiz Starter', 'sponsor', 'Your first branded quiz.', '["One branded challenge or competition","Your logo and colours","Reading material for players","Results and participation report"]', 'campaign', null, false, true, 10),
  ('sponsor_standard', 'campaign', 'Quiz Standard', 'sponsor', 'More players, more reach.', '["Everything in Starter","Sponsored carousel placement","Aimed at your target audience","Prizes and winners list"]', 'campaign', null, true, true, 20),
  ('sponsor_premium', 'campaign', 'Quiz Premium', 'company', 'For a company or brand campaign.', '["Everything in Standard","Several rounds with elimination","Priority placement","Dedicated support"]', 'campaign', null, false, true, 30)
on conflict (code) do nothing;

revoke all on function public.qb_price_admin(), public.qb_price_list(), public.qb_price_list_admin(), public.qb_price_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.qb_price_list() to authenticated, service_role;
grant execute on function public.qb_price_list_admin(), public.qb_price_save(text, jsonb) to authenticated;


notify pgrst, 'reload schema';
