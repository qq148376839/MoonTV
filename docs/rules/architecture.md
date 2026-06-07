# Architecture Constraints

## Layered Architecture

1. **API Route Layer** (`app/api/`) - HTTP handling, Edge Runtime
2. **Business Logic Layer** (`lib/`) - core logic (search, speed-test, storage)
3. **Component Layer** (`components/`) - UI, single responsibility
4. **Config Layer** (`config.json`) - resource site configuration

Rules:

- API routes must be thin - business logic goes in `lib/`
- All DB operations go through the abstraction layer (`lib/db.ts`)
- Resource site logic goes in `lib/downstream.ts`
- No circular dependencies between components

## Frontend

- Server Components by default; `'use client'` only for interactive components
- Tailwind CSS for all styling; dark mode via `next-themes`
- ArtPlayer for video playback with HLS.js integration
- State: React Hooks for simple state, Context API for complex (ThemeProvider, SiteProvider)
- Player state managed via `useRef` (ArtPlayer instance)

## API Design

- RESTful routes using nouns (`/api/search`, `/api/detail`)
- Query params via query string (`/api/search?q=keyword`)
- Standard error response: `{ "error": "description" }` with proper HTTP status codes
- Multi-source search: use `Promise.allSettled` for error tolerance
- Edge Runtime for API routes
