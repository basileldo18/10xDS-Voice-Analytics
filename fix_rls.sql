-- =====================================================
-- Fix RLS Performance Issue
-- =====================================================

-- OPTION 1: Disable RLS temporarily to verify it's the issue
-- (You can re-enable after testing)
ALTER TABLE calls DISABLE ROW LEVEL SECURITY;

-- OPTION 2: If you need RLS, create a permissive policy that's index-friendly
-- First, drop existing policies if they exist
-- DROP POLICY IF EXISTS "Public read access" ON calls;

-- Then create a simple, fast policy
-- CREATE POLICY "Public read access" ON calls
--     FOR SELECT
--     USING (true);  -- Allow all reads (adjust based on your security needs)

-- OPTION 3: If you have user-based RLS, ensure the column used in the policy is indexed
-- For example, if policy filters by user_id:
-- CREATE INDEX idx_calls_user_id ON calls(user_id);

-- Re-analyze after changes
ANALYZE calls;

-- Verify RLS status
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'calls';
