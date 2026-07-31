import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to track page views. Call once in MainLayout.
 */
export function usePageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    // Generate or retrieve session ID
    let sessionId = sessionStorage.getItem("pv_session");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("pv_session", sessionId);
    }

    supabase
      .from("page_views")
      .insert({ page_path: location.pathname, session_id: sessionId })
      .then(); // fire-and-forget
  }, [location.pathname]);
}
