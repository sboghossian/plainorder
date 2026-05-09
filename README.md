# PlainOrder

> Court orders, in plain English. With deadlines, on a calendar.

Paste any court order, ruling, or notice. PlainOrder returns:
- A 2–5 paragraph **plain-English explanation** at an 8th-grade reading level.
- A numbered list of **action items** (what you need to do).
- A list of **deadlines**, plus a downloadable `.ics` calendar file.

Built for people who don't have a lawyer. Submitted to **vibecode.law** in the **Access to Justice** category.

⚠️ **Not legal advice.** PlainOrder is an AI tool. It can be wrong. Read the original document yourself, and call a lawyer or your local legal aid office before acting on anything important.

## How it works

```
+-----------------+      POST /api/translate      +---------------------+      OpenRouter      +--------+
|  static page    | ----------------------------> |  Cloudflare Worker  | ------------------>  | Claude |
|  (Pages)        | <---------------------------- |  + KV rate limit    | <------------------  +--------+
+-----------------+      JSON envelope + .ics     +---------------------+
```

- **Frontend** (`public/`): plain HTML + Tailwind via CDN + one JS file. No build step.
- **Worker** (`worker/`): TypeScript on Cloudflare Workers. Talks to OpenRouter, validates the model's JSON, generates an `.ics` from any deadlines that have a concrete date.
- **Rate limit**: 5 free translations per IP per day, backed by Cloudflare KV. Falls open in local dev if KV isn't bound.
- **Model**: defaults to `anthropic/claude-sonnet-4.5` via OpenRouter. Override with the `PLAINORDER_MODEL` env var without redeploying the prompt.

## Local development

```bash
# 1. Install Worker deps
cd worker
npm install

# 2. Set the OpenRouter key for local dev
echo 'OPENROUTER_API_KEY="sk-or-..."' > .dev.vars

# 3. Run locally — serves the static page AND the Worker on :8787
npx wrangler dev
```

Open http://localhost:8787 in a browser. Paste any court document into the textarea and hit **Translate**.

The static `public/` directory is served via the Worker's `[assets]` binding in `wrangler.toml`, so a single `wrangler dev` command runs everything.

## Deploy to Cloudflare

This repo is set up for Cloudflare Workers (with the static page served via the assets binding). To deploy:

```bash
cd worker

# 1. Create the KV namespace for rate limiting (one-time)
npx wrangler kv namespace create RATELIMIT
# → copy the returned id, paste into wrangler.toml under the kv_namespaces section
# → uncomment the [[kv_namespaces]] block

# 2. Set the OpenRouter API key as a secret
npx wrangler secret put OPENROUTER_API_KEY
# paste your key when prompted

# 3. Deploy
npx wrangler deploy

# 4. Add a custom route in the Cloudflare dashboard (or via wrangler.toml routes):
#    plainorder.dashable.dev/* → this Worker
```

## Project structure

```
plainorder/
├── public/                  # Cloudflare Pages-style static assets
│   ├── index.html           # single-page app
│   └── app.js               # client controller (vanilla)
├── worker/
│   ├── wrangler.toml        # Worker config (assets binding, KV stub)
│   ├── package.json         # wrangler + @cloudflare/workers-types
│   ├── tsconfig.json        # strict TypeScript
│   └── src/
│       ├── index.ts         # /api/translate + asset fallback
│       ├── openrouter.ts    # minimal OpenRouter client
│       ├── prompt.ts        # system prompt (JSON envelope contract)
│       ├── ics.ts           # RFC 5545 .ics generator
│       └── rate-limit.ts    # KV-backed per-IP daily cap
├── tasks/
│   └── todo.md              # build + ship plan
└── README.md
```

## Why this exists

A pro se litigant gets a court order, doesn't understand it, and misses a deadline. That's a recoverable mistake when a lawyer is involved and an unrecoverable one when there isn't one. The legal-aid org pipeline is real but slow. PlainOrder is the 2 AM bridge — not a replacement for legal aid, a referral path *into* it.

vibecode.law's **Access to Justice** track currently has 4 entries. PlainOrder differentiates by combining the explanation with the deadline calendar export — most existing tools do one or the other.

## What this is NOT

- **Not legal advice.** It's a translator. Treat it like Google Translate for legalese.
- **Not jurisdiction-aware.** It does not know your state's procedural rules.
- **Not a deadline calculator.** If the order says "respond within 30 days of service," it tells you that — it does not pick a date.
- **Not stored.** We don't keep the documents you paste. They go to OpenRouter, OpenRouter's per-request log retention applies, then they're gone from our side.

## License

[TBD — defaulting to AGPL-3.0 to prevent closed-source forks. Confirm before publishing publicly.]

## Contributing

Pre-publish. PRs welcome once the public repo exists. The first contributions wanted are jurisdiction-aware deadline math (state by state) and a Spanish-language UI.
