export default {
  async fetch(request, env) {
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('LGY Bot dashboard assets are unavailable.', { status: 503 });
  },
};
