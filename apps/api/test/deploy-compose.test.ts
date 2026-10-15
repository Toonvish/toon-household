// Guards of docker-compose.yml, docker/env.example and .env.local-stack (M6-T02, SPEC D11).
// Docker itself is not needed: the compose file is parsed as YAML and read as text.
// The load-bearing lines: the app is never published and has no capabilities, the Caddy is pinned and
// owns 80/443/443-udp, the old-hostname variables reach the Caddy only (with compose defaults, because
// Caddy treats an empty variable as set), and the local stack runs as a compose project of its own so
// a `down -v` can never reach the production data volume.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const COMPOSE_TEXT = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
const ENV_EXAMPLE = readFileSync(join(ROOT, "docker/env.example"), "utf8");
const LOCAL_STACK = readFileSync(join(ROOT, ".env.local-stack"), "utf8");

interface Service {
  image?: string;
  ports?: string[];
  expose?: string[];
  volumes?: string[];
  networks?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  environment?: Record<string, string>;
  logging?: { driver?: string };
}
interface Compose {
  name: string;
  services: Record<string, Service>;
  networks: Record<string, { driver?: string }>;
  volumes: Record<string, unknown>;
}

const compose = Bun.YAML.parse(COMPOSE_TEXT) as Compose;
const app = compose.services.app as Service;
const caddy = compose.services.caddy as Service;

describe("docker-compose.yml", () => {
  test("project name and services", () => {
    expect(compose.name).toBe("toon-household");
    expect(Object.keys(compose.services)).toEqual(["app", "caddy"]);
  });

  test("the app is private, unprivileged and on the toon network", () => {
    expect(app.ports).toBeUndefined();
    expect(app.expose).toContain("3001");
    expect(app.cap_drop).toEqual(["ALL"]);
    expect(app.security_opt).toContain("no-new-privileges:true");
    expect(app.volumes).toContain("toon-data:/app/data");
    expect(app.networks).toContain("toon");
    expect(app.image).toBe("${TOON_IMAGE:-ghcr.io/toonvish/toon-household:latest}");
  });

  test("the app environment: same-origin bundle, trusted proxy, no Caddy variables", () => {
    const env = app.environment as Record<string, string>;
    expect(env.PUBLIC_API_URL).toBe("");
    expect(env.TRUST_PROXY).toBe("1");
    expect(env.WEB_ORIGIN).toBe("https://${TOON_HOSTNAME}");
    expect(env.DEFAULT_LOCALE).toBe("${DEFAULT_LOCALE:-de}");
    expect(env.MAIL_FROM).toBe("${MAIL_FROM:-Haushalt <haushalt@localhost>}");
    for (const key of ["TOON_TLS_ISSUER", "TOON_HSTS_MAX_AGE", "RECIPE_HOSTNAME", "FINANCE_HOSTNAME"]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  test("the caddy is pinned, owns 80/443/443-udp and keeps its capabilities", () => {
    expect(caddy.image).toBe("caddy:2.11.4-alpine");
    expect(caddy.ports).toEqual(["80:80", "443:443", "443:443/udp"]);
    expect(caddy.volumes).toEqual([
      "./docker/Caddyfile:/etc/caddy/Caddyfile:ro",
      "caddy-data:/data",
      "caddy-config:/config",
    ]);
    expect(caddy).not.toHaveProperty("cap_drop");
    expect(caddy).not.toHaveProperty("cap_add");
  });

  test("the caddy environment carries the hostname, TLS and the old-hostname defaults", () => {
    const env = caddy.environment as Record<string, string>;
    for (const key of ["TOON_HOSTNAME", "TOON_TLS_ISSUER", "TOON_HSTS_MAX_AGE", "RECIPE_HOSTNAME", "FINANCE_HOSTNAME"]) {
      expect(env).toHaveProperty(key);
    }
    expect(env.TOON_HOSTNAME).toStartWith("${TOON_HOSTNAME:?");
    // compose's `:-` is the only thing that covers a set-but-empty variable (Caddy treats it as set)
    expect(env.RECIPE_HOSTNAME).toBe("${RECIPE_HOSTNAME:-http://old-recipe-hostname.unset.invalid}");
    expect(env.FINANCE_HOSTNAME).toBe("${FINANCE_HOSTNAME:-http://old-finance-hostname.unset.invalid}");
  });

  test("network, volumes and logging", () => {
    expect(compose.networks.toon?.driver).toBe("bridge");
    expect(Object.keys(compose.volumes)).toEqual(["toon-data", "caddy-data", "caddy-config"]);
    expect(app.logging?.driver).toBe("json-file");
    expect(caddy.logging?.driver).toBe("json-file");
  });

  test("no mailpit service and no published app port", () => {
    expect(COMPOSE_TEXT).not.toMatch(/^\s+mailpit:/m);
    expect(COMPOSE_TEXT).not.toMatch(/"3001:3001"/);
  });
});

describe("docker/env.example", () => {
  test("documents every variable the compose file interpolates", () => {
    const names = [...COMPOSE_TEXT.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(10);
    for (const name of new Set(names)) {
      expect(ENV_EXAMPLE, `${name} is not documented in docker/env.example`).toMatch(new RegExp(`^#?${name}=`, "m"));
    }
  });

  test("never sets COMPOSE_PROJECT_NAME (production runs under name: toon-household)", () => {
    expect(ENV_EXAMPLE).not.toContain("COMPOSE_PROJECT_NAME");
  });

  test("is English", () => {
    expect(ENV_EXAMPLE).not.toMatch(/\b(Pflicht|Hostname,|Standardfall|Zertifikat(e)?\b|nicht mehr)\b/);
  });
});

describe(".env.local-stack", () => {
  const entries = new Map<string, string>();
  for (const line of LOCAL_STACK.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    entries.set(trimmed.slice(0, at), trimmed.slice(at + 1));
  }

  test("has exactly the eight keys", () => {
    expect([...entries.keys()].sort()).toEqual(
      [
        "COMPOSE_PROJECT_NAME",
        "FINANCE_HOSTNAME",
        "RECIPE_HOSTNAME",
        "SESSION_SECRET",
        "TOON_HOSTNAME",
        "TOON_HSTS_MAX_AGE",
        "TOON_IMAGE",
        "TOON_TLS_ISSUER",
      ].sort(),
    );
  });

  test("runs as its own compose project on the internal CA without HSTS", () => {
    expect(entries.get("COMPOSE_PROJECT_NAME")).toBe("toon-household-local");
    expect(entries.get("TOON_TLS_ISSUER")).toBe("internal");
    expect(entries.get("TOON_HSTS_MAX_AGE")).toBe("0");
    expect(entries.get("TOON_IMAGE")).toBe("toon-household:local");
    expect(entries.get("TOON_HOSTNAME")).toBe("haushalt.test");
    expect(entries.get("RECIPE_HOSTNAME")).toBe("rezepte.test");
    expect(entries.get("FINANCE_HOSTNAME")).toBe("finanzen.test");
  });

  test("has a dummy session secret that the API would accept", () => {
    const secret = entries.get("SESSION_SECRET") ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(secret.startsWith("change-me")).toBe(false);
  });

  test("says it is for local tests only", () => {
    expect(LOCAL_STACK).toContain("never use these values on a server");
  });
});
