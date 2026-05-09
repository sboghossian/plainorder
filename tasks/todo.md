# PlainOrder — build + ship plan

## Phase 1 — Local scaffold (DONE this session)

- [x] Static page (`public/index.html`, `public/app.js`) — paste textarea, translate button, result rendering, .ics download.
- [x] Cloudflare Worker (`worker/src/index.ts`) — POST /api/translate, validates input, calls OpenRouter, parses JSON envelope, generates .ics.
- [x] OpenRouter client (`worker/src/openrouter.ts`) — Sonnet 4.5 default, env-overridable model.
- [x] System prompt (`worker/src/prompt.ts`) — strict JSON envelope contract.
- [x] .ics generator (`worker/src/ics.ts`) — RFC 5545 all-day VEVENTs.
- [x] KV-backed rate limit (`worker/src/rate-limit.ts`) — 5/IP/day, fall-open in dev.
- [x] README with deploy instructions.
- [x] `.gitignore`.
- [ ] **License decision** (AGPL-3.0 recommended, MIT alternative).
- [ ] Local commit (no remote yet).

## Phase 2 — Boot it locally and verify the loop (~30 min)

- [ ] `cd worker && npm install` — pull wrangler + types.
- [ ] Get an OpenRouter key from openrouter.ai (free tier covers testing).
- [ ] `echo 'OPENROUTER_API_KEY="sk-or-..."' > worker/.dev.vars`
- [ ] `cd worker && npx wrangler dev`
- [ ] Open http://localhost:8787, paste a real court order (find one via PACER or Justia for testing), verify:
  - [ ] Plain-English summary renders.
  - [ ] Action items appear as a numbered list.
  - [ ] Deadlines render as pills.
  - [ ] If any deadline has a concrete date, the .ics download works and imports into Calendar.app cleanly.
- [ ] Tweak `worker/src/prompt.ts` if the output is off.
  - Common failure modes: too verbose, gives advice, hallucinates dates, leaks markdown fences.

## Phase 3 — Deploy (~30 min)

- [ ] **Decide GitHub remote.** Per CLAUDE.md global rule: ask before creating one. Suggested: `github.com/sboghossian/plainorder`, public, AGPL-3.0.
- [ ] `gh repo create sboghossian/plainorder --public --source=. --push` (after license decided).
- [ ] `cd worker && npx wrangler kv namespace create RATELIMIT` — paste id into `wrangler.toml`.
- [ ] `npx wrangler secret put OPENROUTER_API_KEY` — production key.
- [ ] `npx wrangler deploy` — publishes the Worker.
- [ ] Cloudflare dashboard:
  - [ ] Add custom route `plainorder.dashable.dev/*` → Worker.
  - [ ] Add the DNS record under `dashable.dev` zone (CNAME → workers).
- [ ] Smoke test the live URL with a real order.

## Phase 4 — Submit to vibecode.law (~20 min)

- [ ] Invoke `/vibecode-submit`.
- [ ] **Category:** Access to Justice.
- [ ] **Tagline:** "Court orders, in plain English. With deadlines, on a calendar."
- [ ] **Project URL:** https://plainorder.dashable.dev
- [ ] **Description:** see README.md "Why this exists" — adapt to 150 words.
- [ ] **Source link:** https://github.com/sboghossian/plainorder

## Phase 5 — Announce (~30 min)

- [ ] Invoke `/linkedin-post` with mode=announcement.
- [ ] Tag legal aid networks (LSC, local legal aid orgs).
- [ ] Update Stephane's project memory: `project_plainorder.md`.
- [ ] Track first 7 days: vibecode.law leaderboard placement, inbound traffic, real user feedback.

## Phase 6 — Iterate based on signal (week 2+)

If real users show up:
- [ ] Add Spanish UI toggle (high-impact A2J win).
- [ ] PDF upload (drag-and-drop, server-side text extraction).
- [ ] Jurisdiction picker → enables deadline math (e.g. "30 days of service" → actual date).

If they don't:
- [ ] Reframe the tagline. "Court orders, decoded." vs "Don't miss a court deadline." — A/B.
- [ ] Reach out to 5 legal aid orgs directly. The B2C funnel is hard; the B2B distribution is real.

## Decisions still on Stephane

1. **License** — AGPL-3.0 (recommended) or MIT.
2. **GitHub remote** — confirm `sboghossian/plainorder` is the right org/name.
3. **Domain** — `plainorder.dashable.dev` (recommended) or own .law domain ($$$).
4. **Default model** — claude-sonnet-4.5 (recommended) or test-drive a few via OpenRouter before locking.
