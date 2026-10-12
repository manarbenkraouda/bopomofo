-- Level summaries (app/levels.py). Each answer updates only the items it tests, so the level check after an answer reads
-- a few hundred summary rows at most, however long the history is. The full history is read once per user, to build them.
-- level_items: one row per exercise and item (a symbol or "tone:N"). last: the last tests, oldest first, [ts, event id, right, ms, day].
CREATE TABLE level_items (
  user_id TEXT NOT NULL DEFAULT app_user(),
  exercise TEXT NOT NULL,
  item TEXT NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  tests INTEGER NOT NULL DEFAULT 0,
  right_days INTEGER NOT NULL DEFAULT 0,
  last JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, exercise, item));

-- level_item_days: the days with a right test, so right_days counts each day once.
CREATE TABLE level_item_days (
  user_id TEXT NOT NULL DEFAULT app_user(),
  exercise TEXT NOT NULL,
  item TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, exercise, item, day));

-- level_built: one row per user when the summaries hold the whole history.
CREATE TABLE level_built (
  user_id TEXT NOT NULL DEFAULT app_user() PRIMARY KEY,
  ts DOUBLE PRECISION NOT NULL);

ALTER TABLE level_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_items FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON level_items USING (user_id = app_user()) WITH CHECK (user_id = app_user());
ALTER TABLE level_item_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_item_days FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON level_item_days USING (user_id = app_user()) WITH CHECK (user_id = app_user());
ALTER TABLE level_built ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_built FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON level_built USING (user_id = app_user()) WITH CHECK (user_id = app_user());
