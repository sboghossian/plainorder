// PlainOrder — Cloudflare Worker entry.
//
// POST /api/translate  → call OpenRouter, parse the JSON envelope, attach
//                         a generated .ics, return to client.
// GET  /healthz        → cheap liveness probe.
// any other route      → fall through to the static assets binding (the
//                         landing page in ../public).

import { translateDocument, type OpenRouterEnv } from './openrouter';
import { buildIcs, type IcsEvent } from './ics';

interface Env extends OpenRouterEnv {
  ASSETS: Fetcher;
}

type Urgency = 'now' | 'soon' | 'info';
type Severity = 'critical' | 'high' | 'normal';

interface ActionItem {
  text: string;
  urgency: Urgency;
}

interface Deadline {
  what: string;
  date: string | null;
  dateDisplay: string;
  notes?: string;
  severity: Severity;
}

interface TranslatePayload {
  plainEnglish: string;
  worstCase: string;
  actionItems: ActionItem[];
  deadlines: Deadline[];
  ics: string;
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

  // Rate limit removed per product decision (2026-05-10). Cost guardrails
  // now live at the OpenRouter account level. Re-enable by importing
  // checkAndConsume from './rate-limit' and reinstating the gate here.

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
    worstCase: parsed.value.worstCase,
    actionItems: parsed.value.actionItems,
    deadlines: parsed.value.deadlines,
    ics,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

interface ParsedEnvelope {
  plainEnglish: string;
  worstCase: string;
  actionItems: ActionItem[];
  deadlines: Deadline[];
}

const URGENCIES: ReadonlySet<Urgency> = new Set(['now', 'soon', 'info']);
const SEVERITIES: ReadonlySet<Severity> = new Set(['critical', 'high', 'normal']);

function parseEnvelope(raw: string): { ok: true; value: ParsedEnvelope } | { ok: false; reason: string } {
  let json: unknown;
  const candidate = extractJsonObject(raw);
  try {
    json = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!json || typeof json !== 'object') return { ok: false, reason: 'not an object' };
  const j = json as Record<string, unknown>;
  const plainEnglish = typeof j.plainEnglish === 'string' ? j.plainEnglish.slice(0, 4000) : '';
  if (!plainEnglish) return { ok: false, reason: 'plainEnglish missing' };
  const worstCase = typeof j.worstCase === 'string' ? j.worstCase.slice(0, 800) : '';
  const actionItems = parseActionItems(j.actionItems);
  const deadlines = parseDeadlines(j.deadlines);
  return { ok: true, value: { plainEnglish, worstCase, actionItems, deadlines } };
}

function parseActionItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionItem[] = [];
  for (const item of raw.slice(0, 12)) {
    // Backward compat: older prompt produced bare strings.
    if (typeof item === 'string') {
      out.push({ text: item.slice(0, 400), urgency: 'soon' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const text = typeof e.text === 'string' ? e.text.slice(0, 400) : '';
    if (!text) continue;
    const u = typeof e.urgency === 'string' ? e.urgency.toLowerCase() : 'soon';
    out.push({ text, urgency: (URGENCIES.has(u as Urgency) ? u : 'soon') as Urgency });
  }
  return out;
}

function parseDeadlines(raw: unknown): Deadline[] {
  if (!Array.isArray(raw)) return [];
  const out: Deadline[] = [];
  for (const item of raw.slice(0, 20)) {
    const e = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
    const sev = typeof e.severity === 'string' ? e.severity.toLowerCase() : 'normal';
    out.push({
      what: typeof e.what === 'string' ? String(e.what).slice(0, 300) : 'Deadline',
      date: typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
      dateDisplay: typeof e.dateDisplay === 'string' ? String(e.dateDisplay).slice(0, 200) : '',
      notes: typeof e.notes === 'string' ? String(e.notes).slice(0, 400) : undefined,
      severity: (SEVERITIES.has(sev as Severity) ? sev : 'normal') as Severity,
    });
  }
  return out;
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

// Defensive: some models wrap JSON in ```json ... ``` fences or add a
// preamble. Strip fences first; if that fails, fall back to slicing
// from the first '{' to the last '}'.
function extractJsonObject(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}
