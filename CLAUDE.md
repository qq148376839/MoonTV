# CLAUDE.md - MoonTV Project Rules

## Project Overview

MoonTV is a Next.js-based video aggregation platform supporting multi-source search, video playback, user favorites, and watch history. Built with TypeScript, Tailwind CSS, and deployed via Docker/Vercel/Cloudflare Pages/Zeabur.

## Tech Stack

- **Framework**: Next.js (App Router) + React 18 + TypeScript 5.9
- **Styling**: Tailwind CSS + Headless UI
- **Player**: ArtPlayer + HLS.js
- **Storage**: localStorage / Redis / Cloudflare D1 / Upstash Redis (unified via `src/lib/db.ts`)
- **Package Manager**: pnpm (v10.12.4)
- **Testing**: Jest + Testing Library
- **Linting**: ESLint + Prettier + Commitlint + Husky

## Directory Structure

```
src/
├── app/              # Next.js App Router (pages + API routes)
│   ├── api/          # Edge Runtime API routes
│   │   ├── search/   # Multi-source aggregation search
│   │   ├── detail/   # Video detail
│   │   ├── parse/    # Official parser (auto-decryption)
│   │   ├── favorites/
│   │   ├── playrecords/
│   │   └── admin/    # Admin endpoints
│   ├── play/         # Playback page
│   ├── player/       # Direct play route
│   ├── search/       # Search page
│   ├── admin/        # Admin panel
│   └── login/        # Authentication
├── components/       # React components (Server Components by default, 'use client' for interactive)
└── lib/              # Business logic and utilities
    ├── downstream.ts # Resource site API integration
    ├── db.ts         # Database abstraction layer
    ├── d1.db.ts      # D1 implementation
    ├── redis.db.ts   # Redis implementation
    ├── config.ts     # Configuration
    ├── decrypt.ts    # Parser decryption
    └── utils.ts      # Utilities
```

## Critical Rules

### Confirm Before Coding (Highest Priority)

When requirements are **unclear or ambiguous**, you MUST stop and ask clarifying questions before writing any code. Specifically:

- Unclear requirements -> ask about use cases, expected behavior, edge cases
- Uncertain technical approach -> present options with trade-offs, let user choose
- Ambiguous business logic -> confirm rules and special cases
- Unknown data formats -> confirm input/output schemas
- Unknown integration points -> confirm API specs

When the user gives a **clear, executable instruction** (e.g., "run build and fix errors", "fix until build passes"), execute directly without asking.

### Build Quality Gates (Mandatory)

Every change must pass these gates:

```bash
pnpm check:fast          # lint:strict + typecheck (run after each small change)
pnpm run build           # full production build (run before committing)
```

- Run `pnpm check:fast` after every logical change
- Run `pnpm lint:fix` for auto-fixable format issues
- `pnpm run build` MUST pass before any commit
- When fixing build errors: make **minimal changes only**, do not refactor unrelated code

### Git Commit Standards

Format: `<type>(<scope>): <subject>`

Types: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `ci`, `test`, `perf`, `revert`, `vercel`

Rules:

- Subject must be lowercase (no Sentence case) - commitlint enforces `subject-case`
- Subject under 72 characters, no trailing period
- Chinese or English both accepted
- Never use `--no-verify` to skip hooks
- Build must pass before committing
- Small, frequent commits - one logical change per commit

## Architecture Constraints

### Layered Architecture

1. **API Route Layer** (`app/api/`) - HTTP handling, Edge Runtime
2. **Business Logic Layer** (`lib/`) - core logic (search, speed-test, storage)
3. **Component Layer** (`components/`) - UI, single responsibility
4. **Config Layer** (`config.json`) - resource site configuration

Rules:

- API routes must be thin - business logic goes in `lib/`
- All DB operations go through the abstraction layer (`lib/db.ts`)
- Resource site logic goes in `lib/downstream.ts`
- No circular dependencies between components

### Frontend

- Server Components by default; `'use client'` only for interactive components
- Tailwind CSS for all styling; dark mode via `next-themes`
- ArtPlayer for video playback with HLS.js integration
- State: React Hooks for simple state, Context API for complex (ThemeProvider, SiteProvider)
- Player state managed via `useRef` (ArtPlayer instance)

### API Design

- RESTful routes using nouns (`/api/search`, `/api/detail`)
- Query params via query string (`/api/search?q=keyword`)
- Standard error response: `{ "error": "description" }` with proper HTTP status codes
- Multi-source search: use `Promise.allSettled` for error tolerance
- Edge Runtime for API routes

## Security Rules

- Sensitive values (API keys, tokens, passwords) MUST use environment variables - never hardcode
- All user input MUST be validated
- D1 database queries MUST use parameterized queries (prevent SQL injection)
- API routes MUST verify permissions
- Admin operations MUST verify admin privileges
- User data MUST be isolated (multi-user support)
- Never commit `.env` files or credentials

## Coding Standards

### TypeScript

- All functions must have explicit parameter types and return types
- Use `interface` for object structures, `type` for unions/utilities
- Avoid `any` - use `unknown` or specific types
- Database query results must be typed

### Naming

- Files: kebab-case (`video-card.tsx`) or PascalCase for components (`VideoCard.tsx`)
- Classes/Interfaces/Types: PascalCase
- Functions/Variables: camelCase
- Constants: UPPER_SNAKE_CASE

### Error Handling

- All API routes must include try/catch with standard error responses
- Client-side: check `response.ok` before parsing
- Log errors with `console.error()` including context
- Never swallow errors silently

### Logging

- `console.error()` for errors, `console.warn()` for warnings
- `console.info()` for key operations (search, playback records, admin actions)
- Never log sensitive data (passwords, tokens)

## MoonTV-Specific Rules

### Search

- Must support multi-source aggregation (compatible with Apple CMS V10 API format)
- Use batch request strategy with timeouts (high-priority 3s, low-priority 5s)
- Early return when results >= 10
- Error tolerance: partial source failure must not break overall results
- Default cache: 2 hours

### Playback

- Speed test timeout: 4 seconds default
- Cache speed test results
- Support source switching while preserving playback progress
- Playback records must persist

### Storage

- Support multiple backends: localStorage, Redis, D1, Upstash
- All access through unified abstraction layer (`lib/db.ts`)
- Playback records and favorites must support cross-device sync

## Documentation

- PRD docs go in `docs/features/` with format: `YYMMDD-功能名称-PRD.md`
- Before creating docs, check if related docs already exist - update rather than duplicate
- One document per feature - don't create separate docs for test/summary/implementation
- Technical docs go in `docs/technical/`

## Common Commands

```bash
pnpm dev                 # Start dev server (port 51000)
pnpm run build           # Production build (6GB memory limit)
pnpm check:fast          # Quick quality check (lint + typecheck)
pnpm lint:fix            # Auto-fix lint + format issues
pnpm test                # Run Jest tests
pnpm typecheck           # TypeScript type checking only
```
