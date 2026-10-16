-- What the coach is building in the background for each user (app/coach/jobs.py), shared by every API process. During a
-- deploy two processes run: the old one finishes the job and the new one shows its progress from this row.
-- beat: the last sign of life of the job; a running job without a recent beat died with its process.
CREATE TABLE coach_jobs (
  user_id TEXT PRIMARY KEY DEFAULT app_user(),
  running BOOLEAN NOT NULL DEFAULT false,
  stage TEXT NOT NULL DEFAULT '',
  error TEXT,
  started DOUBLE PRECISION NOT NULL DEFAULT 0,
  next BOOLEAN NOT NULL DEFAULT false,
  story BIGINT,
  beat DOUBLE PRECISION NOT NULL DEFAULT 0);

ALTER TABLE coach_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON coach_jobs USING (user_id = app_user()) WITH CHECK (user_id = app_user());
