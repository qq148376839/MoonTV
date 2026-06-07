# Coding Standards

## TypeScript

- All functions must have explicit parameter types and return types
- Use `interface` for object structures, `type` for unions/utilities
- Avoid `any` - use `unknown` or specific types
- Database query results must be typed

## Naming

- Files: kebab-case (`video-card.tsx`) or PascalCase for components (`VideoCard.tsx`)
- Classes/Interfaces/Types: PascalCase
- Functions/Variables: camelCase
- Constants: UPPER_SNAKE_CASE

## Error Handling

- All API routes must include try/catch with standard error responses
- Client-side: check `response.ok` before parsing
- Log errors with `console.error()` including context
- Never swallow errors silently

## Logging

- `console.error()` for errors, `console.warn()` for warnings
- `console.info()` for key operations (search, playback records, admin actions)
- Never log sensitive data (passwords, tokens)

## Security

- Sensitive values (API keys, tokens, passwords) MUST use environment variables - never hardcode
- All user input MUST be validated
- D1 database queries MUST use parameterized queries (prevent SQL injection)
- API routes MUST verify permissions
- Admin operations MUST verify admin privileges
- User data MUST be isolated (multi-user support)
- Never commit `.env` files or credentials
