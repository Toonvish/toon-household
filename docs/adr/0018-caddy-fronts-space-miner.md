# 0018: The stack's Caddy also fronts the space-miner game (refines D11)

Date: 2026-11-09

## Context

SPEC D11 gives this stack its own Caddy, which owns ports 80 and 443 on the VPS. The owner also runs
`space-miner` (repository `Toonvish/space-miner`), a browser game with a Colyseus WebSocket server, on
the same machine. Only one process can bind 80/443, and the game needs TLS on its own hostname
(an `https://` page may only open `wss://`). A second Caddy would need other ports or a DNS-01 setup,
and a shared edge proxy is exactly what D11 retired (toon-edge).

## Decision

1. `docker/Caddyfile` gets one optional site, `{$SPACE_MINER_HOSTNAME:http://space-miner.unset.invalid}`,
   that compresses, imports `hardening` and proxies to `space-miner:8080` with `import fwd`. It has no
   `tls` block: the global `cert_issuer` covers it, as it covers the old hostnames (ADR 0008).
   Unset, the address is a `.invalid` placeholder that no request reaches, exactly like
   `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME`; `docker-compose.yml` passes the same non-empty fallback.
2. The game is **not** part of this compose project. It is its own stack in `/opt/space-miner` with its
   own image (`ghcr.io/toonvish/space-miner`), deploy key and forced command
   (`/usr/local/bin/space-miner-deploy`). It joins this stack's network `toon-household_toon` as an
   external network under the alias `space-miner`, and publishes no port.
3. `apps/api/test/deploy-caddyfile.test.ts` pins the new site and widens the "one reverse_proxy" guard
   to exactly two: `app:3001` and `space-miner:8080`. The SPEC §9 rule (no path-prefixed app) still holds:
   the game lives at the root of its own hostname.

## Consequences

- This stack must be up before the game stack starts (the external network has to exist); the game's
  deploy script checks for it.
- While the game container is down, its hostname answers 502; this app is unaffected.
- A Caddy change for the game is made here (and synced with `toon-household-deploy sync-config`), not in
  the game's repository. The game's deploy key cannot touch this stack, and this stack's key cannot touch
  the game.
- Removing the game: unset `SPACE_MINER_HOSTNAME` (the site becomes the inert placeholder) or delete the
  block together with its test.
