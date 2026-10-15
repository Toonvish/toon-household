# toon-household

One installable PWA for a household, with modules: **recipe** (the former
[toon-recipe](https://github.com/Toonvish/toon-recipe): recipes, import, meal plan, shopping lists
that work offline, loyalty cards) and **finance** (the former
[toon-finance](https://github.com/Toonvish/toon-finance): the two-person Haushaltskasse with the
Fixkostenplan). More modules can be added; each household enables the ones it uses.

Status: see the "Status" section of `CLAUDE.md` for what is built and what comes next, and
`docs/SPEC.md` for the decisions and milestones.

Deployment: `docs/deployment.md`; migration of the two old apps: `docs/migration.md`.

Stack: Bun 1.4 workspaces, Bun.serve + Hono, libSQL + Drizzle, React 19 + Vite + TanStack Router +
TanStack Query + Tailwind v4, TypeScript 7 strict, German-first UI with an English interface
option, one Docker container behind its own Caddy.
