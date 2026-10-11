// file: src/api/setup.ts
// description: First-run setup page — enter the DeepSeek (and optional OpenAI) key without restarting
// reference: src/core/llm-settings.ts, src/core/llm-client.ts, src/api/server.ts

import { Hono } from 'hono';
import {
  deepseek_key_source,
  has_deepseek_api_key,
  has_openai_api_key,
  set_deepseek_api_key,
  set_openai_api_key,
} from '../core/llm-settings';
import { check_deepseek_api_key } from '../core/llm-client';

// Mounted outside /api on purpose: everything under /api requires a ClawKeeper JWT, and on first start
// there is no user to have one. Whoever can reach this port can set the key — run it behind an access
// gate (as Insygna does) or set DEEPSEEK_API_KEY in the environment instead.

type KeyChecker = (key: string) => Promise<string | null>;

function escape_html(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function page(message: { kind: 'ok' | 'error'; text: string } | null): string {
  const configured = has_deepseek_api_key();
  const source = deepseek_key_source();
  const status = configured
    ? `DeepSeek key configured${source === 'environment' ? ' (from DEEPSEEK_API_KEY)' : ' (entered here — kept until the process restarts)'}.`
    : 'No DeepSeek key yet — the AI agents cannot parse invoices or categorise expenses until one is entered.';
  const banner = message
    ? `<p class="${message.kind}">${escape_html(message.text)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClawKeeper setup</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; }
  main { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; }
  .status { color: #475569; }
  .ok { color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 12px; border-radius: 8px; }
  .error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 8px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
  small { color: #64748b; font-size: 12px; }
  button { margin-top: 20px; background: #0369a1; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>ClawKeeper setup</h1>
  <p class="status" data-testid="setup-status">${escape_html(status)}</p>
  ${banner}
  <form method="post" action="/setup">
    <label for="deepseek_api_key">DeepSeek API key${configured ? ' (leave empty to keep the current one)' : ''}</label>
    <input id="deepseek_api_key" name="deepseek_api_key" type="password" autocomplete="off" ${configured ? '' : 'required'}>
    <small>Used by every agent for invoice parsing, categorisation and analysis. Checked with DeepSeek before it is saved.</small>
    <label for="openai_api_key">OpenAI API key (optional)</label>
    <input id="openai_api_key" name="openai_api_key" type="password" autocomplete="off">
    <small>Only for OCR of uploaded invoices and semantic search. ${has_openai_api_key() ? 'One is already set.' : 'Without it those two features are unavailable.'}</small>
    <button type="submit">Save</button>
  </form>
</main>
</body>
</html>`;
}

export function setup_routes(check_key: KeyChecker = check_deepseek_api_key): Hono {
  const app = new Hono();

  // Until a key is entered the setup page is the only useful thing on this port.
  app.get('/', c => (has_deepseek_api_key() ? c.redirect('/health') : c.redirect('/setup')));

  app.get('/setup', c => c.html(page(null)));

  app.get('/setup/status', c => c.json({
    deepseek_configured: has_deepseek_api_key(),
    deepseek_source: deepseek_key_source(),
    openai_configured: has_openai_api_key(),
  }));

  app.post('/setup', async c => {
    const body = await c.req.parseBody();
    const deepseek = String(body.deepseek_api_key ?? '').trim();
    const openai = String(body.openai_api_key ?? '').trim();

    if (!deepseek && !has_deepseek_api_key()) {
      return c.html(page({ kind: 'error', text: 'Enter a DeepSeek API key.' }), 400);
    }
    if (deepseek) {
      const problem = await check_key(deepseek);
      if (problem) return c.html(page({ kind: 'error', text: `${problem} Nothing was saved.` }), 400);
      set_deepseek_api_key(deepseek);
    }
    set_openai_api_key(openai);
    console.log('[Setup] LLM keys updated on /setup');
    return c.html(page({ kind: 'ok', text: 'Saved. ClawKeeper agents can now use the LLM.' }));
  });

  return app;
}
