// Backend entry point. Static assets in dist/ are served before this runs;
// only /api/* requests (see run_worker_first in wrangler.jsonc) reach it.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
