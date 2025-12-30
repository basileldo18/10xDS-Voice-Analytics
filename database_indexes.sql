-- =====================================================
-- Performance Optimization Indexes for Calls Table
-- =====================================================
-- 
-- INSTRUCTIONS:
-- 1. Open Supabase Dashboard
-- 2. Navigate to: SQL Editor
-- 3. Paste this script and click "Run"
-- 
-- EXPECTED IMPACT:
-- - Query time reduction: 20+ seconds → < 100ms
-- - Eliminates full table scans on ORDER BY created_at
-- =====================================================

-- Index for fast sorting by created_at (descending)
-- Used by: /api/calls main query and stats query
CREATE INDEX IF NOT EXISTS idx_calls_created_at 
ON calls(created_at DESC);

-- Optional: Composite index for filtering + sorting
-- Uncomment if you add WHERE clauses on sentiment or tags
-- CREATE INDEX IF NOT EXISTS idx_calls_sentiment_created_at 
-- ON calls(sentiment, created_at DESC);

-- Analyze table to update query planner statistics
ANALYZE calls;

-- Verify index creation
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'calls'
ORDER BY indexname;
