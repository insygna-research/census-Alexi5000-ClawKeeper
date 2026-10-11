// file: tests/api/setup.test.ts
// description: The LLM key is optional at start and can be entered on /setup
// reference: src/api/setup.ts, src/core/llm-settings.ts, src/core/llm-client.ts

import { describe, test, beforeEach } from 'node:test';
import { expect } from '../support/expect';
import { setup_routes } from '../../src/api/setup';
import { get_deepseek_client } from '../../src/core/llm-client';
import {
  get_deepseek_api_key,
  LlmNotConfiguredError,
  reset_llm_settings_for_tests,
} from '../../src/core/llm-settings';

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

describe('LLM key setup', () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    reset_llm_settings_for_tests();
  });

  // The process used to die at import: the OpenAI SDK throws on an undefined key.
  test('the LLM client module loads without a key, and a call says how to configure one', () => {
    expect(get_deepseek_api_key()).toBe(null);
    let thrown: unknown = null;
    try { get_deepseek_client(); } catch (e) { thrown = e; }
    expect(thrown instanceof LlmNotConfiguredError).toBe(true);
    expect(String((thrown as Error).message)).toContain('/setup');
  });

  test('the root sends a first visitor to the setup page', async () => {
    const res = await setup_routes(async () => null).request('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  test('a key DeepSeek accepts is saved and used', async () => {
    const app = setup_routes(async () => null);
    const res = await app.request('/setup', form({ deepseek_api_key: '  sk-good  ', openai_api_key: '' }));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Saved');
    expect(get_deepseek_api_key()).toBe('sk-good');
    expect(get_deepseek_client()).toBeDefined();
    const status = await (await app.request('/setup/status')).json();
    expect(status.deepseek_configured).toBe(true);
    expect(status.deepseek_source).toBe('setup');
  });

  test('a key DeepSeek rejects is not saved', async () => {
    const app = setup_routes(async () => 'DeepSeek rejected this key.');
    const res = await app.request('/setup', form({ deepseek_api_key: 'sk-bad' }));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Nothing was saved');
    expect(get_deepseek_api_key()).toBe(null);
  });

  test('an empty form is refused while no key exists', async () => {
    const res = await setup_routes(async () => null).request('/setup', form({ deepseek_api_key: '' }));
    expect(res.status).toBe(400);
  });

  test('a key from the environment counts, and the optional OpenAI key can be added on its own', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-env';
    const app = setup_routes(async () => { throw new Error('must not be checked'); });

    const res = await app.request('/setup', form({ deepseek_api_key: '', openai_api_key: 'sk-openai' }));

    expect(res.status).toBe(200);
    expect(get_deepseek_api_key()).toBe('sk-env');
    expect(process.env.OPENAI_API_KEY).toBe('sk-openai');
  });
});
