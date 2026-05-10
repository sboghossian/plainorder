// PlainOrder — minimal OpenRouter client.
//
// Single-call chat completions. We use Sonnet by default (good cost/quality
// for this task); the model id is overridable via env so we can A/B
// without redeploying the prompt.

import { SYSTEM_PROMPT } from './prompt';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
const REQUEST_TIMEOUT_MS = 60_000;

export interface OpenRouterEnv {
  OPENROUTER_API_KEY: string;
  /** Override the default model — useful for A/B. */
  PLAINORDER_MODEL?: string;
  /** Optional: site URL for OpenRouter analytics. */
  PLAINORDER_SITE_URL?: string;
}

export type SupportedLang = 'en' | 'es';

const LANG_LABEL: Record<SupportedLang, string> = {
  en: 'English',
  es: 'Spanish (español)',
};

export async function translateDocument(
  env: OpenRouterEnv,
  documentText: string,
  lang: SupportedLang = 'en',
): Promise<string> {
  const model = env.PLAINORDER_MODEL || DEFAULT_MODEL;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    'X-Title': 'PlainOrder',
  };
  if (env.PLAINORDER_SITE_URL) {
    headers['HTTP-Referer'] = env.PLAINORDER_SITE_URL;
  }
  const langDirective = `\n\nIMPORTANT: All string field VALUES in your JSON output (plainEnglish, worstCase, actionItems[].text, deadlines[].what, deadlines[].dateDisplay, deadlines[].notes) MUST be written in ${LANG_LABEL[lang]}. The JSON field NAMES stay in English. Translate plain-language explanations into ${LANG_LABEL[lang]} regardless of the language the source document is in. Use natural ${LANG_LABEL[lang]} phrasing — do not translate word-for-word from English templates.`;
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + langDirective },
      { role: 'user', content: documentText },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    // Note: response_format json_object isn't honored uniformly across
    // OpenRouter providers (Anthropic in particular ignores it). The
    // prompt enforces JSON-only output and the parser strips fences,
    // so we don't need to set response_format here.
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned empty content');
  }
  return content;
}
