# MoonTV Business Rules

## Search

- Must support multi-source aggregation (compatible with Apple CMS V10 API format)
- Use batch request strategy with timeouts (high-priority 3s, low-priority 5s)
- Early return when results >= 10
- Error tolerance: partial source failure must not break overall results
- Default cache: 2 hours

## Playback

- Speed test timeout: 4 seconds default
- Cache speed test results
- Support source switching while preserving playback progress
- Playback records must persist

## Storage

- Support multiple backends: localStorage, Redis, D1, Upstash
- All access through unified abstraction layer (`lib/db.ts`)
- Playback records and favorites must support cross-device sync
