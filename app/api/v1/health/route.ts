import pkg from "@/package.json";
import { probeClerk, probeSupabase } from "@/lib/health";

export async function GET() {
  const [supabase, clerk] = await Promise.all([
    probeSupabase({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY }),
    probeClerk({ secretKey: process.env.CLERK_SECRET_KEY }),
  ]);
  return Response.json(
    { version: pkg.version, time: new Date().toISOString(), services: { supabase, clerk } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
