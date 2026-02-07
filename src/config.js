// Environment configuration
// For Cloudflare Pages: Set these in dashboard under Settings > Environment Variables
// For local dev: Create .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

// Fallback values for production (these are safe to expose - anon key is public)
const FALLBACK_URL = 'https://voctlyuhrgpgpljekzbp.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvY3RseXVocmdwZ3BsamVremJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzU0NTksImV4cCI6MjA4NjAxMTQ1OX0.WfTW6rheSQo9QMMUqD0cY3pvLuMu4TpSL4_OIiVNcW0';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;

// Log config status (only in dev)
if (import.meta.env.DEV) {
    console.log('Supabase URL:', SUPABASE_URL ? '✓ configured' : '✗ missing');
}
