// PlainOrder — Cloudflare Worker entry.
//
// POST /api/translate  → call OpenRouter, parse the JSON envelope, attach
//                         a generated .ics, return to client.
// GET  /healthz        → cheap liveness probe.
// any other route      → fall through to the static assets binding (the
//                         landing page in ../public).

import { translateDocument, type OpenRouterEnv } from './openrouter';
import { checkAndConsume, type RateLimitEnv } from './rate-limit';
import { buildIcs, type IcsEvent } from './ics';

interface Env extends OpenRouterEnv, RateLimitEnv {
  ASSETS: Fetcher;
}

interface TranslatePayload {
  plainEnglish: string;
  actionItems: string[];
  deadlines: Array<{
    what: string;
    date: string | null;
    dateDisplay: string;
    notes?: string;
  }>;
  ics: string;
  remaining: number;
}

const MIN_INPUT_CHARS = 50;
const MAX_INPUT_CHARS = 30_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/api/translate') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }
      if (request.method !== 'POST') {
        return jsonError(405, 'Method not allowed.');
      }
      return handleTranslate(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleTranslate(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) {
    return jsonError(500, 'Server is missing OPENROUTER_API_KEY. Tell the operator.');
  }

  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return jsonError(400, 'Body must be JSON: { text: "..." }');
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < MIN_INPUT_CHARS) {
    return jsonError(400, `Document is too short (${text.length} chars). Paste at least ${MIN_INPUT_CHARS}.`);
  }
  if (text.length > MAX_INPUT_CHARS) {
    return jsonError(413, `Document is too long. Max ${MAX_INPUT_CHARS} characters; you sent ${text.length}.`);
  }

  const limit = await checkAndConsume(env, request);
  if (!limit.allowed) {
    return jsonError(429, 'You have used your 5 free translations for today. Come back tomorrow, or run PlainOrder yourself — the source is open.');
  }

  let raw: string;
  try {
    raw = await translateDocument(env, text);
  } catch (err) {
    return jsonError(502, `Translation service failed: ${stringifyErr(err)}`);
  }

  const parsed = parseEnvelope(raw);
  if (!parsed.ok) {
    return jsonError(502, `Translation came back malformed: ${parsed.reason}`);
  }

  const icsEvents: IcsEvent[] = parsed.value.deadlines.map((d) => ({
    date: d.date,
    what: d.what,
    notes: d.notes,
  }));
  const ics = buildIcs(icsEvents);

  const payload: TranslatePayload = {
    plainEnglish: parsed.value.plainEnglish,
    actionItems: parsed.value.actionItems,
    deadlines: parsed.value.deadlines,
    ics,
    remaining: limit.remaining,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

interface ParsedEnvelope {
  plainEnglish: string;
  actionItems: string[];
  deadlines: Array<{
    what: string;
    date: string | null;
    dateDisplay: string;
    notes?: string;
  }>;
}

function parseEnvelope(raw: string): { ok: true; value: ParsedEnvelope } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!json || typeof json !== 'object') return { ok: false, reason: 'not an object' };
  const j = json as Record<string, unknown>;
  const plainEnglish = typeof j.plainEnglish === 'string' ? j.plainEnglish.slice(0, 4000) : '';
  if (!plainEnglish) return { ok: false, reason: 'plainEnglish missing' };
  const actionItems = Array.isArray(j.actionItems)
    ? j.actionItems.filter((x) => typeof x === 'string').slice(0, 12).map((x) => String(x).slice(0, 400))
    : [];
  const rawDeadlines = Array.isArray(j.deadlines) ? j.deadlines : [];
  const deadlines = rawDeadlines.slice(0, 20).map((d) => {
    const e = (d && typeof d === 'object') ? d as Record<string, unknown> : {};
    return {
      what: typeof e.what === 'string' ? String(e.what).slice(0, 300) : 'Deadline',
      date: typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
      dateDisplay: typeof e.dateDisplay === 'string' ? String(e.dateDisplay).slice(0, 200) : '',
      notes: typeof e.notes === 'string' ? String(e.notes).slice(0, 400) : undefined,
    };
  });
  return { ok: true, value: { plainEnglish, actionItems, deadlines } };
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err).slice(0, 200);
}
