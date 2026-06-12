# XShield Architecture

## Overview

XShield is a pnpm monorepo with a Chrome Extension app and reusable packages.

## Packages

- `@xshield/shared`: common types, constants, and default configuration.
- `@xshield/rule-engine`: pure detection and scoring logic.
- `@xshield/block-executor`: queue consumer, retry behavior, pause and resume controls.
- `@xshield/search-engine`: manual user search abstraction placeholder.
- `@xshield/search-engine`: manual user search abstraction with a local mock provider.
- `@xshield/extension`: Manifest V3 Chrome extension with React UI and IndexedDB storage.

## Data Flow

1. The content script observes visible X/Twitter articles.
2. Visible profiles are sent to the background service worker.
3. The background worker loads rules from IndexedDB and evaluates profiles.
4. Matched profiles are upserted into the local candidate pool.
5. Dashboard pages read and manage local data.
6. Block executor consumes queued items through an adapter. The MVP adapter is a mock.
7. Dashboard writes activity logs for local review and persists queue settings in IndexedDB.

## Safety Boundary

Rule Engine only identifies and scores users. Block Executor only consumes queue items. Neither module imports the other. Real platform actions must remain behind explicit adapters and user-controlled limits.

## Local Tables

- `candidates`: detected or manually added users.
- `rules`: keyword and regex detection rules.
- `blockQueue`: user-controlled mock execution queue.
- `logs`: local activity events.
- `settings`: score threshold, queue pause state, and executor configuration.
