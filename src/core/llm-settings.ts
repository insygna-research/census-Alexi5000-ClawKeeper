// file: src/core/llm-settings.ts
// description: Runtime LLM credentials — entered on the /setup page or taken from the environment
// reference: src/core/llm-client.ts, src/api/setup.ts

// The DeepSeek key used to be read once, when llm-client.ts was imported, and the OpenAI SDK throws on an
// undefined key — so a container started without DEEPSEEK_API_KEY died before the API was listening.
// The key is now optional at start: it comes from the environment if present, or is entered on /setup,
// and every LLM call reads it here at the moment it runs.
//
// A key entered on /setup lives in this process's memory only. A restart asks again; set DEEPSEEK_API_KEY
// in the environment to keep one across restarts.

let deepseek_api_key: string | null = null;

export function get_deepseek_api_key(): string | null {
  const runtime = deepseek_api_key?.trim();
  if (runtime) return runtime;
  const env = process.env.DEEPSEEK_API_KEY?.trim();
  return env ? env : null;
}

export function has_deepseek_api_key(): boolean {
  return get_deepseek_api_key() !== null;
}

/** Where the key in effect came from — shown on the setup page. */
export function deepseek_key_source(): 'setup' | 'environment' | null {
  if (deepseek_api_key?.trim()) return 'setup';
  return process.env.DEEPSEEK_API_KEY?.trim() ? 'environment' : null;
}

export function set_deepseek_api_key(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('The DeepSeek API key is empty');
  deepseek_api_key = trimmed;
}

/**
 * The OpenAI key is optional — OCR and embeddings already fall back to a placeholder without one. Their
 * services read OPENAI_API_KEY when they are constructed, so a key entered on /setup is placed there and
 * picked up by every service created afterwards.
 */
export function set_openai_api_key(key: string): void {
  const trimmed = key.trim();
  if (trimmed) process.env.OPENAI_API_KEY = trimmed;
}

export function has_openai_api_key(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** For tests only. */
export function reset_llm_settings_for_tests(): void {
  deepseek_api_key = null;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('No DeepSeek API key is configured. Open /setup in a browser to enter one, or set DEEPSEEK_API_KEY.');
    this.name = 'LlmNotConfiguredError';
  }
}
