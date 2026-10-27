import type { NextConfig } from "next";

/**
 * Sandbox-only settings, all gated on BASE44_PREVIEW_MODE === "1" (unset anywhere else, so the app
 * behaves exactly as before).
 *
 * - allowedDevOrigins: the Base44 preview proxies port 3000, and Next gates its dev assets and HMR by
 *   origin.
 * - trustHostHeader: the sandbox's proxy forwards plain HTTP without X-Forwarded-Proto, so without
 *   this the server believes the request came over http. Clerk's hosted sign-in ("handshake") sends
 *   the browser back to a redirect_url built from that scheme, and an http redirect inside the
 *   https preview never completes. Next's own answer for a front-end proxy is this flag: absolute
 *   URLs are built as https://<host>.
 */
const sandbox = process.env.BASE44_PREVIEW_MODE === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins:
    sandbox && process.env.BASE44_PUBLIC_HOST_SUFFIX ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`] : [],
};

export default nextConfig;
