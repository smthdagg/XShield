# XShield User Guide

## 1. Installation

### Load the built extension

1. Open Chrome.
2. Visit `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `apps/extension/dist`.
6. Pin XShield to the Chrome toolbar.

### Build from source

Requirements: Node.js 20+ and pnpm 9+.

```bash
corepack enable
pnpm install
pnpm build
```

Then load `apps/extension/dist`.

## 2. Create Rules

Open **Rules** in the dashboard.

- `keyword`: plain keyword, one per line.
- `regex`: regular expression, one per line.
- Fields: username, display name, bio, post content.
- Score: risk score added when the rule matches.
- Rules can be created, edited, saved, cancelled, and deleted.

Matched posts are highlighted in light yellow, and matched users are added to the candidate pool.

## 3. Review Candidate Users

Open **Candidate Users**.

- Review avatar, profile link, bio, follower information, and match reason.
- Add confirmed targets to the block queue.
- Add false positives to the whitelist.
- Use select all, multi-select, delete, and whitelist actions.

## 4. Run the Block Queue

Open **Block Queue**.

- **Run Batch** follows the configured batch size, interval, and mode.
- **Manual Block Now** ignores the configured interval but still processes by batch. Blocking too many users at once may affect your account.
- **Start/Stop** controls whether the automatic queue is paused.
- **Delete Selected** removes users from the queue.
- **Whitelist Selected** removes users from the queue and adds them to the whitelist.

## 5. Export Blocked Users

Open **Blocked Users**, choose an export format, and click **Export Blocked Users**.

Supported formats:

- TXT: simple username list.
- CSV: spreadsheet-friendly format.
- JSON: structured data for scripts and applications.
- NDJSON: line-delimited JSON for logs or streaming tools.
- SQL: insert statements for database migration or later processing.

## 6. Settings

- Language: system, Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French.
- Rule mode: automatic or manual.
- Block mode: mock or real.
- Score threshold: minimum score for candidate detection.
- Batch size: users processed per batch.
- Interval minutes: automatic queue interval.
- Max retries: retry count after failure.
- Failure cooldown: wait time after repeated failures.

## 7. Real Block Mode

Real block mode depends on your current X/Twitter login session in Chrome. It may stop working if X changes its web API, login flow, CSRF handling, or page structure.

Recommendations:

- Start with mock mode.
- Use conservative batches, such as 50 to 100 users.
- Use intervals of at least 10 minutes.
- Avoid frequent manual immediate blocks.
- You are responsible for account safety, platform rules, and local legal compliance.

## 8. FAQ

### Search returns no users

Open X search pages or relevant posts first so the extension can collect visible users. Manual search works best with collected users and visible X search results.

### Real block fails

Check:

- You are logged in to X.
- Settings use real mode.
- The queue has `queued` users.
- Dashboard logs show whether auth, API, not-found, or ID mismatch errors occurred.

### Why are many users skipped?

Common reasons:

- User no longer exists.
- User is already blocked.
- User ID and username do not match.
- User is whitelisted.
- User is already recorded as blocked locally.
