import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to auth(). It does not decide access:
// getAccount() in lib/auth does, inside each route.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next.js internals, static files, the public health check, the webhook and cron jobs.
    "/((?!_next|api/v1/health|api/webhooks|api/cron|.*\\.(?:ico|png|svg|jpg|jpeg|webp|css|js|woff2?|txt)$).*)",
  ],
};
