/** `webcalUrl` swaps the scheme only (plan m9 P16). */
import { describe, expect, test } from "bun:test";
import { webcalUrl } from "./webcal";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

describe("webcalUrl", () => {
  test.each([
    [`https://haushalt.example.de/api/calendar/feed/${TOKEN}.ics`, `webcal://haushalt.example.de/api/calendar/feed/${TOKEN}.ics`],
    [`http://localhost/api/calendar/feed/${TOKEN}.ics`, `webcal://localhost/api/calendar/feed/${TOKEN}.ics`],
    [`http://127.0.0.1:3001/api/calendar/feed/${TOKEN}.ics`, `webcal://127.0.0.1:3001/api/calendar/feed/${TOKEN}.ics`],
    [`https://haushalt.test/api/calendar/feed/${TOKEN}.ics?x=1`, `webcal://haushalt.test/api/calendar/feed/${TOKEN}.ics?x=1`],
    [`HTTPS://Haushalt.Test/api/calendar/feed/${TOKEN}.ics`, `webcal://Haushalt.Test/api/calendar/feed/${TOKEN}.ics`],
  ])("%s", (url, expected) => {
    expect(webcalUrl(url)).toBe(expected);
  });

  test("a value that is not an http(s) URL is unchanged", () => {
    expect(webcalUrl("webcal://haushalt.test/x.ics")).toBe("webcal://haushalt.test/x.ics");
    expect(webcalUrl("/api/calendar/feed/x.ics")).toBe("/api/calendar/feed/x.ics");
  });

  test("only the leading scheme changes", () => {
    expect(webcalUrl("https://a.test/https://b.test")).toBe("webcal://a.test/https://b.test");
  });
});
