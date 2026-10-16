/**
 * The provider payload parsers of apps/api/src/lib/oauth.ts: `parseGoogleClaims`,
 * `parseGitHubUser`, `parseGitHubEmails`. Each returns the parsed value (unknown keys stripped) or
 * `undefined`, which `googleProfile` / `githubProfile` turn into the documented 400 `oauth_failed`.
 * Imports no schema library (plan e1 P20): the same file runs unchanged before and after the
 * claim schemas moved from Zod to Effect Schema.
 */
import { describe, expect, test } from "bun:test";
import { parseGitHubEmails, parseGitHubUser, parseGoogleClaims } from "../src/lib/oauth";

describe("parseGoogleClaims", () => {
  const accepted: Array<[string, unknown, Record<string, unknown>]> = [
    ["the minimum: a sub", { sub: "1" }, { sub: "1" }],
    [
      "every field",
      {
        sub: "108",
        email: "Ada@Example.org",
        email_verified: true,
        name: "Ada Lovelace",
        given_name: "Ada",
        picture: "https://img.example/a.png",
      },
      {
        sub: "108",
        email: "Ada@Example.org",
        email_verified: true,
        name: "Ada Lovelace",
        given_name: "Ada",
        picture: "https://img.example/a.png",
      },
    ],
    ["email_verified as the string true", { sub: "1", email_verified: "true" }, { sub: "1", email_verified: "true" }],
    ["email_verified as the string false", { sub: "1", email_verified: "false" }, { sub: "1", email_verified: "false" }],
    ["email_verified false", { sub: "1", email_verified: false }, { sub: "1", email_verified: false }],
    ["an empty email", { sub: "1", email: "" }, { sub: "1", email: "" }],
    ["unknown keys are stripped", { sub: "1", locale: "de", hd: "x" }, { sub: "1" }],
    ["a one-character sub", { sub: "x" }, { sub: "x" }],
    ["explicit undefined optionals", { sub: "1", email: undefined, name: undefined }, { sub: "1" }],
  ];
  for (const [name, raw, expected] of accepted) {
    test(`accepts ${name}`, () => {
      expect(parseGoogleClaims(raw) as unknown).toEqual(expected);
    });
  }

  const refused: Array<[string, unknown]> = [
    ["no sub", { email: "a@b.c" }],
    ["an empty sub", { sub: "" }],
    ["a numeric sub", { sub: 108 }],
    ["a null sub", { sub: null }],
    ["a null email", { sub: "1", email: null }],
    ["a numeric email", { sub: "1", email: 5 }],
    ["email_verified as a number", { sub: "1", email_verified: 1 }],
    ["email_verified null", { sub: "1", email_verified: null }],
    ["a non-string name", { sub: "1", name: 7 }],
    ["a non-string given_name", { sub: "1", given_name: false }],
    ["a non-string picture", { sub: "1", picture: {} }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "sub"],
    ["a number", 1],
    ["an array", [{ sub: "1" }]],
    ["an empty array", []],
  ];
  for (const [name, raw] of refused) {
    test(`refuses ${name}`, () => {
      expect(parseGoogleClaims(raw)).toBeUndefined();
    });
  }
});

describe("parseGitHubUser", () => {
  const accepted: Array<[string, unknown, Record<string, unknown>]> = [
    ["a numeric id", { id: 583231, login: "octocat" }, { id: 583231, login: "octocat" }],
    ["a string id", { id: "583231", login: "octocat" }, { id: "583231", login: "octocat" }],
    ["id zero", { id: 0, login: "x" }, { id: 0, login: "x" }],
    ["an empty login", { id: 1, login: "" }, { id: 1, login: "" }],
    [
      "every field",
      { id: 1, login: "octocat", name: "The Octocat", email: "o@example.org", avatar_url: "https://a/b.png" },
      { id: 1, login: "octocat", name: "The Octocat", email: "o@example.org", avatar_url: "https://a/b.png" },
    ],
    [
      "null name, email and avatar",
      { id: 1, login: "octocat", name: null, email: null, avatar_url: null },
      { id: 1, login: "octocat", name: null, email: null, avatar_url: null },
    ],
    [
      "absent name, email and avatar",
      { id: 1, login: "octocat" },
      { id: 1, login: "octocat" },
    ],
    ["undefined name", { id: 1, login: "octocat", name: undefined }, { id: 1, login: "octocat" }],
    ["unknown keys are stripped", { id: 1, login: "o", plan: { name: "free" }, type: "User" }, { id: 1, login: "o" }],
  ];
  for (const [name, raw, expected] of accepted) {
    test(`accepts ${name}`, () => {
      expect(parseGitHubUser(raw) as unknown).toEqual(expected);
    });
  }

  const refused: Array<[string, unknown]> = [
    ["no id", { login: "octocat" }],
    ["no login", { id: 1 }],
    ["a null id", { id: null, login: "o" }],
    ["a boolean id", { id: true, login: "o" }],
    ["a NaN id", { id: Number.NaN, login: "o" }],
    ["an Infinity id", { id: Number.POSITIVE_INFINITY, login: "o" }],
    ["a null login", { id: 1, login: null }],
    ["a numeric login", { id: 1, login: 5 }],
    ["a numeric name", { id: 1, login: "o", name: 5 }],
    ["a numeric email", { id: 1, login: "o", email: 5 }],
    ["an object avatar_url", { id: 1, login: "o", avatar_url: {} }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "octocat"],
    ["an array", [{ id: 1, login: "o" }]],
  ];
  for (const [name, raw] of refused) {
    test(`refuses ${name}`, () => {
      expect(parseGitHubUser(raw)).toBeUndefined();
    });
  }
});

describe("parseGitHubEmails", () => {
  const accepted: Array<[string, unknown, unknown[]]> = [
    ["an empty list", [], []],
    ["a bare address", [{ email: "a@b.c" }], [{ email: "a@b.c" }]],
    [
      "primary and verified flags",
      [
        { email: "a@b.c", primary: true, verified: true },
        { email: "d@e.f", primary: false, verified: false },
      ],
      [
        { email: "a@b.c", primary: true, verified: true },
        { email: "d@e.f", primary: false, verified: false },
      ],
    ],
    ["only primary", [{ email: "a@b.c", primary: true }], [{ email: "a@b.c", primary: true }]],
    ["only verified", [{ email: "a@b.c", verified: true }], [{ email: "a@b.c", verified: true }]],
    [
      "unknown keys are stripped",
      [{ email: "a@b.c", primary: true, verified: true, visibility: "public" }],
      [{ email: "a@b.c", primary: true, verified: true }],
    ],
    ["an empty address", [{ email: "" }], [{ email: "" }]],
    ["undefined flags", [{ email: "a@b.c", primary: undefined }], [{ email: "a@b.c" }]],
  ];
  for (const [name, raw, expected] of accepted) {
    test(`accepts ${name}`, () => {
      expect(parseGitHubEmails(raw) as unknown).toEqual(expected);
    });
  }

  const refused: Array<[string, unknown]> = [
    ["a non-boolean primary", [{ email: "a@b.c", primary: "true" }]],
    ["a numeric primary", [{ email: "a@b.c", primary: 1 }]],
    ["a null primary", [{ email: "a@b.c", primary: null }]],
    ["a non-boolean verified", [{ email: "a@b.c", verified: "yes" }]],
    ["a missing address", [{ primary: true }]],
    ["a null address", [{ email: null }]],
    ["one bad entry among good ones", [{ email: "a@b.c" }, { email: 5 }]],
    ["a non-object entry", ["a@b.c"]],
    ["a null entry", [null]],
    ["an object instead of a list", { email: "a@b.c" }],
    ["GitHub's error object", { message: "Bad credentials", status: "401" }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "a@b.c"],
  ];
  for (const [name, raw] of refused) {
    test(`refuses ${name}`, () => {
      expect(parseGitHubEmails(raw)).toBeUndefined();
    });
  }
});
