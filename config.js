// Stone Dragon — Supabase config. The anon key is public-by-design and safe to ship.
// VAPID_PUBLIC_KEY is the web-push application server key (also public by design;
// its private half lives only in the send-push Edge Function's secrets).
window.STONE_DRAGON_CONFIG = {
  SUPABASE_URL: "https://thhfslggjmtciavxrwwz.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoaGZzbGdnam10Y2lhdnhyd3d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzI2ODgsImV4cCI6MjA5ODM0ODY4OH0.PCD2RIwyn2lV4ZLGbg4z4zOe8_k8DXOeEEcLnjfSqFc",
  VAPID_PUBLIC_KEY: "BJDrxqC-2mCPimJIdlQoBen_xbb64Eq_tmUZxyL3-ZiArVVG1Jf0pZ310nR7j6lIa1kQ-dQMnNVz2tkBBE45Yts"
};
