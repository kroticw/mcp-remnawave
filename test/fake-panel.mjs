// Preloaded into the MCP server process (`node --import`): replaces fetch with a fake
// Remnawave panel that records every request as one JSON line in FAKE_PANEL_LOG.
import { appendFileSync } from 'node:fs';

globalThis.fetch = async (url, options = {}) => {
    appendFileSync(
        process.env.FAKE_PANEL_LOG,
        JSON.stringify({
            method: options.method ?? 'GET',
            url: String(url),
            headers: options.headers ?? {},
            body: options.body ? JSON.parse(options.body) : undefined,
        }) + '\n',
    );
    const isAuthStatus = String(url).endsWith('/api/auth/status');
    const payload = isAuthStatus
        ? { response: { branding: { title: process.env.FAKE_PANEL_TITLE ?? 'Fake Panel' } } }
        : { response: {} };
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
};
