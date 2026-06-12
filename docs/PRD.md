# XShield PRD

## Goal

XShield helps users detect and manage suspicious X/Twitter accounts locally in a Chrome extension. It focuses on spam-like, adult-content, scam, and traffic-diversion signals through user-controlled rules.

## MVP Scope

- Collect visible users from X/Twitter page content.
- Evaluate collected profiles with keyword and regex rules.
- Store candidate users, rules, and block queue items in IndexedDB.
- Provide Dashboard pages for overview, candidates, rules, block queue, whitelist, logs, and settings.
- Provide a safe block executor abstraction with rate limits, retry handling, pause, and resume.
- Use a mock block adapter only in the first phase.
- Provide local manual search for adding a username into candidate review.
- Provide local activity logs and editable queue settings.

## Non-Goals

- No bypassing platform protections.
- No automated hidden clicking implementation.
- No scraping outside the user's visible browsing context.
- No remote account database in the MVP.

## Acceptance

- `pnpm install` succeeds.
- `pnpm build` succeeds.
- Rule engine has independent unit tests.
- Block executor does not depend on rule engine.
- Dexie database initializes in the extension context.
- Dashboard can open from the built extension.
- Rules can be created, edited, toggled, and deleted locally.
- Candidates can be queued, whitelisted, restored, and soft-deleted locally.
- Queue can be paused, resumed, and executed through the mock adapter.
