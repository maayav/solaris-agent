-- Solaris-Agent Supabase Schema
-- Cross-engagement persistent storage

-- ===========================================
-- DROP EXISTING TABLES (clean slate)
-- ===========================================
DROP TABLE IF EXISTS public.target_configs CASCADE;
DROP TABLE IF EXISTS public.run_reports CASCADE;
DROP TABLE IF EXISTS public.cross_engagement_lessons CASCADE;
DROP TABLE IF EXISTS public.engagements CASCADE;

-- ===========================================
-- ENGAGEMENTS TABLE
-- ===========================================
CREATE TABLE public.engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT '',
  scope TEXT[] NOT NULL DEFAULT '{}',
  out_of_scope TEXT[] NOT NULL DEFAULT '{}',
  tech_stack TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'complete', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_engagements_status ON public.engagements(status);
CREATE INDEX idx_engagements_target ON public.engagements(target_url);

-- ===========================================
-- CROSS_ENGAGEMENT_LESSONS TABLE
-- ===========================================
CREATE TABLE public.cross_engagement_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stack_fingerprint JSONB NOT NULL,
  engagement_id UUID REFERENCES public.engagements(id) ON DELETE SET NULL,
  engagement_name TEXT,
  target_class TEXT NOT NULL,
  exploit_type TEXT NOT NULL,
  failure_class TEXT,
  successful_payload TEXT,
  delta TEXT,
  reusable BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_lessons_fingerprint ON public.cross_engagement_lessons USING GIN(stack_fingerprint);
CREATE INDEX idx_lessons_target_class ON public.cross_engagement_lessons(target_class);
CREATE INDEX idx_lessons_tags ON public.cross_engagement_lessons USING GIN(tags);
CREATE INDEX idx_lessons_engagement ON public.cross_engagement_lessons(engagement_id);

-- ===========================================
-- RUN_REPORTS TABLE
-- ===========================================
CREATE TABLE public.run_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID REFERENCES public.engagements(id) ON DELETE CASCADE,
  summary JSONB NOT NULL DEFAULT '{"mission_count": 0}',
  findings JSONB NOT NULL DEFAULT '[]',
  credentials_discovered JSONB NOT NULL DEFAULT '[]',
  attack_chains_completed JSONB NOT NULL DEFAULT '[]',
  format TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'md', 'html')),
  version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'final')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_engagement ON public.run_reports(engagement_id);
CREATE INDEX idx_reports_status ON public.run_reports(status);

-- ===========================================
-- TARGET_CONFIGS TABLE
-- ===========================================
CREATE TABLE public.target_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID REFERENCES public.engagements(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  target_name TEXT,
  config JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_target_configs_engagement ON public.target_configs(engagement_id);
CREATE INDEX idx_target_configs_target ON public.target_configs(target_url);
CREATE INDEX idx_target_configs_active ON public.target_configs(is_active);

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================
CREATE OR REPLACE FUNCTION public.search_lessons_by_stack(
  p_stack_fingerprint JSONB,
  p_target_class TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS SETOF public.cross_engagement_lessons AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.cross_engagement_lessons
  WHERE 
    target_class = p_target_class
    AND (
      stack_fingerprint->'framework' @> p_stack_fingerprint->'framework'
      OR stack_fingerprint->'framework' <@ p_stack_fingerprint->'framework'
    )
    AND reusable = true
  ORDER BY 
    use_count ASC,
    created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_lesson_use(p_lesson_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.cross_engagement_lessons
  SET 
    use_count = use_count + 1,
    last_used_at = NOW()
  WHERE id = p_lesson_id;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- ROW LEVEL SECURITY (RLS)
-- ===========================================
ALTER TABLE public.engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cross_engagement_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.target_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for engagements" ON public.engagements FOR ALL USING (true);
CREATE POLICY "Allow all for lessons" ON public.cross_engagement_lessons FOR ALL USING (true);
CREATE POLICY "Allow all for reports" ON public.run_reports FOR ALL USING (true);
CREATE POLICY "Allow all for target configs" ON public.target_configs FOR ALL USING (true);
