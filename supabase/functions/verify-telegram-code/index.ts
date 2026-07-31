import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { disabledLegacyFunction } from "../_shared/disabled.ts";

serve(disabledLegacyFunction);
