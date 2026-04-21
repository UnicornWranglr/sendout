# SendOut — System Design Doc

**Status:** Draft v1 — PR 1 shipped 2026-04-21 (S1/S2 resolved; see §6). Sections 2.1 and 2.3 describe the pre-PR1 state.
**Date:** 2026-04-21
**Author:** Daniel (with Claude)
**Scope:** Evaluate the current SendOut architecture and propose a target state that addresses security, scale, latency, and cost constraints while staying cheap and simple enough for a one-person operation to run.

---

## 1. Context

SendOut is a single-user web tool that turns a recruitment consultant's weekly activity notes into a polished client-facing update via Claude (`claude-sonnet-4-6`). Today it is a pure client-side React SPA: the user fills a six-field form, the browser calls the Anthropic API directly, the response is rendered in a card and copied to clipboard. There is no backend, no persistence, no authentication.

The tool works, but it is built in a shape that will not survive much real-world use. The most important thing this doc does is name the risks clearly, then propose the smallest target architecture that removes them without over-engineering.

### Goals

The system should let a consultant write a weekly client update in under two minutes, with confidence that the output reads like they wrote it, and without re-typing the same client context every week. It should be safe to keep the link open on a personal device without leaking an API key that can be burned by anyone who sees the page source. Unit cost per update should stay under a few cents, and monthly infra cost should stay under the price of a lunch.

### Non-goals

A multi-tenant SaaS platform is not in scope. Neither is team collaboration, billing, or an in-app email send. The tool produces text that the consultant copy-pastes into their own email client; that boundary stays where it is.

### Constraints the user flagged

Scale and latency (the generation step feels slow, and the user wants it to feel snappy even when they are on a train) and cost (stay on free tiers where possible, avoid anything with a minimum monthly charge).

---

## 2. Current architecture

### 2.1 Shape

```
Browser (SPA)
   │
   │  POST  https://api.anthropic.com/v1/messages
   │  x-api-key: <VITE_ANTHROPIC_API_KEY from bundle>
   │  anthropic-dangerous-direct-browser-access: true
   ▼
Anthropic API  →  claude-sonnet-4-6
```

Everything lives in `src/App.tsx` (344 lines): form state, prompt template, fetch call, output rendering, copy-to-clipboard. No router, no backend, no storage. Deployment is a Vite static build served by Vercel, with `@vercel/analytics` for page-level telemetry.

### 2.2 Evaluation — what is good

The product surface is small and the code is easy to read. React 19 + Vite gives fast iteration. Tailwind 4 keeps styling local to JSX. Treating the Claude API as the entire "backend" is exactly the right instinct for a v0 — it got the thing shipped. The prompt itself is well-crafted: explicit tone guidance, length target, output-only contract, optional-field handling. That prompt is the product; everything else should exist to serve it.

### 2.3 Evaluation — risks, ranked

**(S1 — Critical) API key leaks to the client bundle.** `VITE_` environment variables are embedded in the static JavaScript bundle at build time. Anyone who opens the network tab, views page source, or forks the deployed URL can extract `VITE_ANTHROPIC_API_KEY` in seconds. The `anthropic-dangerous-direct-browser-access: true` header that Anthropic requires is itself a signal — the API team added that header specifically so nobody ships this pattern by accident. Impact: an attacker burns the consultant's Anthropic spend, or worse, uses the key under the consultant's org for content that violates Anthropic's usage policy. Likelihood: certain, the moment the URL is indexed or shared.

**(S2 — High) No rate limiting.** Even without a leaked key, the generate button can be pressed in a loop. There is no per-session or per-IP throttle. Combined with S1 this becomes a direct route to a surprise bill.

**(R1 — High) No persistence.** Every week, the consultant re-types the client name, company, role title, and requirements for the same search. This is the single biggest latency hit on the human side of the system: the Claude call takes 3–8 seconds; re-entering context takes 60–120 seconds. The product is 10x more valuable the moment it remembers.

**(L1 — Medium) No streaming.** The UI blocks on the full response, so the user watches a spinner for several seconds with no feedback. Streaming would collapse perceived latency without touching real latency.

**(L2 — Medium) `max_tokens: 1024` is fine today but tight.** A 250-word update is ~330 tokens; 1024 leaves headroom, but a verbose model response could be silently clipped mid-sentence with no retry path.

**(M1 — Low) Monolithic `App.tsx`.** Not a scaling problem yet, but any feature beyond "one more field" will get messy fast.

**(M2 — Low) Error handling is a flat catch.** Network errors, 401s, 429s, and content filters all produce the same generic red banner. Actionable for the user only when the Anthropic error message happens to be readable.

---

## 3. Target architecture

The smallest change that removes the critical risks is to put a thin server between the browser and Anthropic. Everything else — history, context reuse, streaming — is cheap once that server exists.

### 3.1 High-level shape

```
                    ┌──────────────────────────────┐
                    │         Browser (SPA)         │
                    │  React 19 • Vite • Tailwind   │
                    └──────────────┬───────────────┘
                                   │ 1. auth cookie (httpOnly)
                                   │ 2. POST /api/generate (stream)
                                   │ 3. GET/POST /api/updates, /api/clients
                                   ▼
                    ┌──────────────────────────────┐
                    │      Vercel Edge Functions    │
                    │  ─ /api/auth/*                │
                    │  ─ /api/generate  (SSE)       │
                    │  ─ /api/updates   (CRUD)      │
                    │  ─ /api/clients   (CRUD)      │
                    └─────┬─────────────┬──────────┘
                          │             │
                          │             │  server-side key
                          │             ▼
                          │     ┌───────────────┐
                          │     │  Anthropic    │
                          │     │  Messages API │
                          │     └───────────────┘
                          ▼
                 ┌────────────────┐      ┌─────────────────┐
                 │ Neon Postgres  │      │  Upstash Redis  │
                 │  (free tier)   │      │  rate-limit +   │
                 │  history,      │      │  session cache  │
                 │  clients,      │      │                 │
                 │  roles         │      │                 │
                 └────────────────┘      └─────────────────┘
```

All three managed services have generous free tiers and zero cold-start minimums, which matches the cost constraint. Vercel is already in play, so deploying the functions adds no vendor.

### 3.2 Components

The browser keeps its current job — rendering forms and output — plus two new responsibilities: calling a cookie-authenticated backend, and streaming the response token-by-token. It no longer knows the Claude API key exists.

The **auth** function issues a magic link over email (Resend free tier, 3k/mo). Given the tool is single-user today, even simpler options exist: a long-lived bearer token stored in Vercel env and typed once, or Vercel's built-in password protection on the preview URL. Magic-link is the cheapest option that also works if the consultant wants to add a colleague later without re-architecting.

The **generate** function is the only hot path. It validates the authenticated session, runs a Redis-backed token-bucket rate limit (e.g. 20 generations/hour, 200/day), loads any referenced client/role context from Postgres, composes the prompt (same template as today, pulled out into a module), calls Anthropic with `stream: true`, and forwards the SSE stream to the browser. On successful completion it writes the generated update plus the input payload to Postgres.

The **updates** and **clients** CRUD functions are thin JSON endpoints over Postgres. They exist so the consultant can pick a client from a dropdown ("Sarah @ Acme, Senior PM") and have the form pre-fill, and so past updates can be reopened, edited, and re-copied.

Upstash Redis is only here for the rate limit and a short-lived session cache. If that starts looking unnecessary, drop it — Postgres can hold the counter with a row-level lock; it's just cheaper not to round-trip to the DB on every keystroke of `/api/generate`.

### 3.3 Data model

```
clients (
  id            uuid pk,
  user_id       uuid fk → users.id,
  contact_name  text not null,
  company       text not null,
  notes         text,               -- free-form "what do they care about"
  created_at    timestamptz,
  updated_at    timestamptz
)

roles (
  id            uuid pk,
  client_id     uuid fk → clients.id,
  title         text not null,
  requirements  text not null,       -- free-form
  status        text,                -- "active" | "paused" | "filled"
  created_at    timestamptz
)

updates (
  id                 uuid pk,
  user_id            uuid fk → users.id,
  role_id            uuid fk → roles.id nullable,  -- allow ad-hoc generations
  week_of            date,
  weekly_activity    text not null,   -- the raw brain-dump
  market_obs         text,
  generated_body     text not null,
  prompt_version     text not null,   -- which prompt template was used
  model              text not null,   -- for future A/B
  input_tokens       int,
  output_tokens      int,
  created_at         timestamptz
)
```

Two design notes. First, `role_id` is nullable so the form can still be used in "quick mode" without pre-selecting a client — the current behaviour. Second, `prompt_version` and `model` are recorded on every row; when the prompt gets tuned, historical generations stay reproducible and the consultant can diff "old prompt" vs "new prompt" on real inputs.

### 3.4 API contract

```
POST /api/generate
  body: {
    roleId?: string,
    clientName: string,
    hiringCompany: string,
    roleTitle: string,
    keyRequirements: string,
    weeklyActivity: string,
    marketObservations?: string
  }
  response: text/event-stream
    event: token       data: "partial text..."
    event: usage       data: {"input_tokens":..., "output_tokens":...}
    event: done        data: {"updateId":"..."}
    event: error       data: {"code":"...", "message":"..."}

GET  /api/clients               → [Client]
POST /api/clients                → Client
GET  /api/clients/:id/roles     → [Role]
POST /api/clients/:id/roles     → Role

GET  /api/updates?roleId=&limit= → [Update]
GET  /api/updates/:id            → Update
```

REST over JSON is the right call here: there are six endpoints, one of them streams, and the consumer is one hand-written React client. GraphQL and gRPC both add tooling cost that a single-user tool will never earn back.

---

## 4. Scale, latency, cost

### 4.1 Load estimation

Realistic worst case: a consultant running 10 active searches, writing one update per search per week, plus ad-hoc regenerations. Call it 100 generations/week, so ~15/day. Peak concurrency is 1 (one human, one browser tab). Storage grows by ~100 rows/week in `updates`, each row ~5 KB — about 25 MB/year. This fits on any free tier forever.

### 4.2 Latency budget

End-to-end today the user waits 3–8 seconds on a spinner. The target is "first token in under 800 ms, full response in under 8 s, perceived wait dominated by reading the tokens as they stream." Breakdown:

- **Browser → Vercel Edge**: 30–80 ms from the UK (Vercel has LHR edges).
- **Edge function warm-up**: ~0 ms warm, 100–300 ms cold. Edge runtime (not Node serverless) keeps cold starts low.
- **Auth + rate-limit check**: one Redis round-trip, ~5–20 ms to Upstash's nearest region.
- **Postgres read for context** (if `roleId` is passed): ~10–30 ms to Neon's EU region.
- **Anthropic first token**: typically 400–800 ms for Sonnet.
- **Anthropic streaming**: the full 250-word response streams in 2–5 s; the user starts reading at first token.
- **Postgres write on completion**: fire-and-forget, off the critical path.

Net: first byte in under 1 s, full response in ≤6 s, perceived wait closer to 1–2 s because tokens are visible. That is the single biggest UX win in this redesign — and it costs almost nothing, because Anthropic already supports `stream: true`.

### 4.3 Cost model

Per generation, assuming ~600 input tokens (prompt + context) and ~400 output tokens with Sonnet 4.6: pennies per call, well under $0.05 each at current rates. At 100/week that is ~$20/month on the Anthropic side, dominated entirely by the model, not infra.

Infra itself:
- **Vercel Hobby**: free; edge functions, analytics, preview deploys all included.
- **Neon free tier**: 0.5 GB storage, always-on branch; fits 20+ years of updates.
- **Upstash Redis free tier**: 10k commands/day, more than enough for rate-limit checks and session tokens.
- **Resend free tier**: 3k emails/month, magic-link auth burns maybe 10/month.

Expected infra spend: $0. The one thing to watch is Vercel function execution time if the consultant ever makes a huge batch of generations — stay inside the 100k GB-seconds/month hobby limit. At ~6 s/call and 128 MB, that's >400k generations/month headroom.

### 4.4 Reliability

Anthropic rate-limits and transient 5xxs are the main failure mode. Wrap the Anthropic call in a single retry-with-jitter on 429/503 (not on 4xx content errors). Surface specific error types to the UI: "rate limited, try again in N seconds" is actionable, "something went wrong" is not. For everything else, a single Vercel region is fine — this is a personal tool, not a regulated product; a 10-minute Vercel outage is acceptable.

### 4.5 Monitoring

Vercel's built-in function logs plus Vercel Analytics is enough for now. Add a structured log line on every generation with `{userId, updateId, inputTokens, outputTokens, latencyMs, model, promptVersion}` so cost-per-call and latency-per-call are queryable without a separate APM vendor. If the tool ever gets shared, plug in Axiom or Logtail on the free tier.

---

## 5. Trade-offs made explicit

**Adding a backend vs staying client-only.** The cost of a backend is a few hundred lines of code, ~4 hours of work, and one more thing to debug. The benefit is that the API key stops leaking, rate limiting becomes possible, and the path to persistence and streaming opens up. For a tool that costs real money per call and runs on a personal Anthropic account, the key-leak risk alone justifies the move. Recommend: do it.

**Vercel Edge Functions vs Node serverless.** Edge is faster (cold starts, global deployment) but has a narrower runtime — some Node APIs and some npm packages won't run. For this workload (fetch to Anthropic, fetch to Postgres via HTTP driver, fetch to Redis) Edge is fine, and Neon/Upstash both publish Edge-compatible clients. Recommend: Edge; fall back to Node serverless only if a library forces it.

**Neon Postgres vs Vercel KV vs SQLite on a volume.** KV is the simplest option and is tempting, but the data model has real relations (client → roles → updates) and the consultant will want to filter and sort past updates. Postgres on Neon costs the same ($0 on the free tier) and gives indexes, JOINs, and a real query language for $0 more. SQLite on a volume doesn't work on serverless Edge. Recommend: Neon.

**Magic-link auth vs bearer token vs Vercel password protection.** Password protection is one click and zero code — the cheapest option if the tool will only ever have one user. Magic-link costs maybe 60 lines of code and opens the door to a second user without re-architecting. Bearer token is fine for a CLI but awkward in a browser. Recommend: start with Vercel password protection, move to magic-link only when a second person actually wants in.

**Streaming now vs batch now.** Streaming is the single biggest perceived-latency win and is cheap to implement both server-side and client-side. Recommend: ship streaming in the same PR that introduces the backend.

**Rate limit values.** 20/hour and 200/day are guesses based on "one human actively working"; real limits should be set once there's a week of logged data. Recommend: start generous, tighten based on observed usage.

---

## 6. Migration / rollout

The cleanest path is four small PRs, each independently shippable, in this order. First, move the Anthropic call behind a Vercel function with the API key server-side, keeping the UI stateless (this alone closes S1 and S2). Second, add Vercel password protection and streaming — perceived latency drops immediately. Third, add Neon + the `updates` table and start logging every generation; no UI change yet, just historical data accumulating. Fourth, add the `clients` and `roles` tables plus UI for "pick an existing client" — this is where the product becomes 10x more useful than today.

Every step is reversible: the SPA still works if the backend is down (it just fails closed), and the database tables can be dropped without affecting the current generation flow.

---

## 7. What I'd revisit as the system grows

If this ever becomes a multi-tenant product, three things need a second pass. The prompt lives in code today, which is fine for one prompt author; with more than one consultant, prompts need to be data (per-user or per-workspace template strings in Postgres) so each user can tune tone without a deploy. Auth needs to move from magic-link to proper SSO (Google/Microsoft) because recruitment is a mostly-enterprise audience. And the `updates` table will want a text-search index (`tsvector` in Postgres is free) once anyone wants to find "that update I wrote about the CFO search in January."

The thing I would not revisit is the overall shape. A thin Edge function in front of Anthropic with a small relational store behind it is the correct architecture for a tool in this class; it scales from one user to tens of thousands without structural change, and the bits that would need to change at that point (queueing, multi-region, model selection layer) are all additive.

---

## 8. Open questions

Three things I'd want Daniel's answer on before cutting tickets. One: is a second user plausible in the next six months, or is this strictly personal? That decides password-protection vs magic-link. Two: should past updates be editable after generation, or read-only? Editable is more work but closer to how a consultant actually uses the output. Three: does the consultant ever want to see "all updates across all clients for week of X" as a digest, or is single-update-at-a-time the whole job? The data model supports both; the UI decision changes what gets built in the fourth PR.
