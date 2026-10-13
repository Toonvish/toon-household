/**
 * The SMTP adapter, driven over a real socket against a fake relay.
 *
 * This is the transport that replaced the Resend API key for a self-hosted
 * install, so it is tested against an actual server rather than a stubbed client:
 * `startRelay()` below is a ~100-line ESMTP server on `node:net` that records the
 * command transcript and the DATA payload. Everything the adapter is responsible
 * for — capability parsing, multiline replies, AUTH PLAIN vs LOGIN, the STARTTLS
 * upgrade, RFC 2047 subjects, dot-stuffing — is asserted end to end.
 *
 * The TLS tests generate a throwaway self-signed certificate with `openssl` and
 * SKIP THEMSELVES if it is not on PATH, so the suite still passes on a machine
 * without it. Everything security-relevant that does NOT need a certificate (the
 * refusal to continue when a relay does not offer STARTTLS) is always tested.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as netConnect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket, createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import {
  SmtpMailer,
  addressOf,
  buildMessage,
  dotStuff,
  encodeAddressHeader,
  encodeHeaderValue,
} from "../../src/core/services/mail/smtp.ts";

/* -------------------------------------------------------------------------- */
/* the fake relay                                                             */
/* -------------------------------------------------------------------------- */

interface RelayOptions {
  /** ESMTP capability lines answered to EHLO, without the `250` prefix. */
  capabilities?: string[];
  /** Forces a reply for the first command that starts with the given verb. */
  failOn?: { verb: string; reply: string };
  /** `plain` | `tls` (implicit) | `starttls` (upgrade on demand). */
  mode?: "plain" | "tls" | "starttls";
  tls?: { key: string; cert: string };
}

interface Relay {
  port: number;
  /** Every command line the client sent, DATA content excluded. */
  transcript: string[];
  /** One entry per accepted message, exactly as it arrived (dot-stuffing removed). */
  messages: string[];
  close(): Promise<void>;
}

async function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const capabilities = options.capabilities ?? ["SIZE 10240000", "8BITMIME", "HELP"];
  const mode = options.mode ?? "plain";
  const transcript: string[] = [];
  const messages: string[] = [];
  const failed = new Set<string>();
  /**
   * Every socket this relay owns — the accepted connections AND the bridge legs.
   *
   * `close()` has to destroy them, because `net.Server.close(cb)` only calls back
   * once every connection has ENDED (node semantics, which Bun implements since
   * 1.4 — under 1.3 the callback fired straight away). A STARTTLS session ends on
   * the INNER TLS socket, so QUIT never closes the outer plaintext connection and
   * the callback would wait for a socket nobody is going to end.
   */
  const sockets = new Set<Socket | TLSSocket>();
  /**
   * Port of the internal TLS listener a STARTTLS session is bridged into, or 0.
   *
   * WHY A BRIDGE AND NOT `new TLSSocket(socket, { isServer: true })`: under Bun
   * 1.3 that constructor never completed the handshake, so the obvious way to
   * write this fake relay hung — and it hung identically whether or not the CLIENT
   * was correct, which made it useless as a test. Bun 1.4 completes it (verified),
   * but the bridge stays: `tls.createServer()` is a REAL TLS terminator rather
   * than the runtime's server-side upgrade path, so the test cannot pass because
   * of a bug on both ends at once. The plaintext socket is piped byte-for-byte
   * into that listener once the 220 has gone out. The client under test still
   * performs a genuine upgrade on a single connection, which is the thing being
   * verified.
   *
   * (The client-side `tls.connect({ socket })` that src/services/mail/smtp.ts uses
   * is fine under Bun — verified separately against `openssl s_server`.)
   */
  let tlsPort = 0;

  /**
   * Runs the ESMTP state machine over one (possibly upgraded) socket.
   *
   * `greet` is false for the socket handed back by STARTTLS: a real relay sends NO
   * second 220 there, the client just sends EHLO again. Greeting anyway would make
   * the adapter read that 220 as the reply to its EHLO and hide a genuine bug.
   */
  const serve = (socket: Socket | TLSSocket, greet = true): void => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let data = "";
    /** Set while AUTH LOGIN is mid-exchange: "user" then "password". */
    let loginStep: "user" | "password" | null = null;

    const write = (line: string): void => void socket.write(`${line}\r\n`);

    const handle = (line: string): void => {
      if (inData) {
        if (line === ".") {
          inData = false;
          // Undo the client's dot-stuffing, the way a real relay does.
          messages.push(data.replace(/^\.\./gm, "."));
          data = "";
          write("250 2.0.0 Ok: queued as FAKE1");
          return;
        }
        data += `${line}\r\n`;
        return;
      }

      if (loginStep === "user") {
        transcript.push(`AUTH-LOGIN-USER ${line}`);
        loginStep = "password";
        write("334 UGFzc3dvcmQ6");
        return;
      }
      if (loginStep === "password") {
        transcript.push(`AUTH-LOGIN-PASSWORD ${line}`);
        loginStep = null;
        write("235 2.7.0 Authentication successful");
        return;
      }

      transcript.push(line);
      const verb = line.split(" ")[0]?.toUpperCase() ?? "";

      if (options.failOn && verb === options.failOn.verb.toUpperCase() && !failed.has(verb)) {
        failed.add(verb);
        write(options.failOn.reply);
        return;
      }

      switch (verb) {
        case "EHLO":
        case "HELO": {
          // Deliberately multiline: the adapter has to keep reading until it sees a
          // line whose separator is a space rather than a hyphen.
          const lines = [...capabilities];
          if (mode === "starttls" && !(socket instanceof TLSSocket)) lines.push("STARTTLS");
          write(`250-fake-relay greets you`);
          for (const entry of lines.slice(0, -1)) write(`250-${entry}`);
          write(`250 ${lines.at(-1) ?? "HELP"}`);
          return;
        }
        case "STARTTLS": {
          if (mode !== "starttls" || tlsPort === 0) {
            write("502 5.5.1 Not implemented");
            return;
          }
          // The 220 must be on the wire BEFORE the socket stops being plaintext,
          // so the upgrade happens in the write callback.
          socket.removeAllListeners("data");
          socket.write("220 2.0.0 Ready to start TLS\r\n", () => {
            // Everything from here is ciphertext, bridged verbatim into a real
            // TLS listener (see `tlsPort`). Anything still buffered belongs to the
            // plaintext phase and would corrupt the handshake, so assert it is gone.
            if (buffer.length > 0) throw new Error(`unexpected pipelined data: ${buffer}`);
            const bridge = netConnect({ host: "127.0.0.1", port: tlsPort }, () => {
              socket.pipe(bridge);
              bridge.pipe(socket);
            });
            sockets.add(bridge);
            bridge.on("close", () => sockets.delete(bridge));
            bridge.on("error", () => socket.destroy());
          });
          return;
        }
        case "AUTH": {
          const mechanism = line.split(" ")[1]?.toUpperCase();
          if (mechanism === "PLAIN") {
            write("235 2.7.0 Authentication successful");
            return;
          }
          if (mechanism === "LOGIN") {
            loginStep = "user";
            write("334 VXNlcm5hbWU6");
            return;
          }
          write("504 5.5.4 Unrecognized authentication type");
          return;
        }
        case "MAIL":
        case "RCPT":
          write("250 2.1.0 Ok");
          return;
        case "DATA":
          inData = true;
          write("354 End data with <CR><LF>.<CR><LF>");
          return;
        case "QUIT":
          write("221 2.0.0 Bye");
          socket.end();
          return;
        default:
          write("500 5.5.2 Command unrecognized");
      }
    };

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        handle(line);
      }
    });
    socket.on("error", () => undefined);
    if (greet) write("220 fake-relay ESMTP ready");
  };

  const server: Server | TlsServer =
    mode === "tls" && options.tls
      ? createTlsServer({ key: options.tls.key, cert: options.tls.cert }, serve)
      : createServer(serve);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = portOf(server);

  // The TLS terminator a STARTTLS session gets bridged into. It speaks the same
  // state machine, minus the greeting, exactly like the upgraded connection does.
  let tlsServer: TlsServer | null = null;
  if (mode === "starttls" && options.tls) {
    tlsServer = createTlsServer({ key: options.tls.key, cert: options.tls.cert }, (secure) =>
      serve(secure, false),
    );
    await new Promise<void>((resolve) => tlsServer?.listen(0, "127.0.0.1", resolve));
    tlsPort = portOf(tlsServer);
  }

  return {
    port,
    transcript,
    messages,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (tlsServer) await new Promise<void>((resolve) => tlsServer?.close(() => resolve()));
    },
  };
}

/** The bound port of a listening server. */
function portOf(server: Server | TlsServer): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/** The base64 body of the first (or only) part, decoded. */
function decodedBody(raw: string): string {
  const parts = raw.split("\r\n\r\n");
  const body = parts.slice(1).join("\r\n\r\n");
  const base64 = body
    .split("\r\n")
    .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line) && line.length > 0)
    .join("");
  return Buffer.from(base64, "base64").toString("utf8");
}

function headerOf(raw: string, name: string): string {
  // Unfold first: a long encoded subject is split over CRLF + space.
  const unfolded = raw.replace(/\r\n[ \t]+/g, "");
  const match = new RegExp(`^${name}: (.*)$`, "m").exec(unfolded);
  return match?.[1]?.trim() ?? "";
}

/** Decodes a header made of RFC 2047 base64 encoded-words. */
function decodeEncodedWords(value: string): string {
  return value.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_match, encoded: string) =>
    Buffer.from(encoded, "base64").toString("utf8"),
  );
}

const FROM = "Rezepte <no-reply@rezepte.test>";

/* -------------------------------------------------------------------------- */
/* a throwaway certificate for the TLS paths                                  */
/* -------------------------------------------------------------------------- */

let certificate: { key: string; cert: string } | null = null;
let certDir: string | null = null;

beforeAll(async () => {
  certDir = mkdtempSync(join(tmpdir(), "toon-smtp-"));
  const keyPath = join(certDir, "key.pem");
  const certPath = join(certDir, "cert.pem");
  const openssl = Bun.spawn(
    [
      "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await openssl.exited) !== 0) return;
  certificate = {
    key: await Bun.file(keyPath).text(),
    cert: await Bun.file(certPath).text(),
  };
});

afterAll(() => {
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* the session                                                                */
/* -------------------------------------------------------------------------- */

describe("SmtpMailer session", () => {
  test("delivers a plain-text mail and speaks the whole ESMTP sequence in order", async () => {
    const relay = await startRelay();
    try {
      const mailer = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      });
      await mailer.send({
        to: "max@beispiel.de",
        subject: "Willkommen",
        text: "Hallo Max,\n\nhier ist dein Link: https://rezepte.test/invite/abc\n",
      });

      const verbs = relay.transcript.map((line) => line.split(" ")[0]?.toUpperCase());
      expect(verbs).toEqual(["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]);
      // The envelope carries the bare address, never the display name.
      expect(relay.transcript[1]).toBe("MAIL FROM:<no-reply@rezepte.test>");
      expect(relay.transcript[2]).toBe("RCPT TO:<max@beispiel.de>");

      expect(relay.messages).toHaveLength(1);
      const raw = relay.messages[0] ?? "";
      expect(headerOf(raw, "From")).toBe(FROM);
      expect(headerOf(raw, "To")).toBe("max@beispiel.de");
      expect(headerOf(raw, "Subject")).toBe("Willkommen");
      expect(headerOf(raw, "Date")).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} .* \+0000$/);
      expect(headerOf(raw, "Message-ID")).toMatch(/^<.+@rezepte\.test>$/);
      expect(decodedBody(raw)).toContain("https://rezepte.test/invite/abc");
    } finally {
      await relay.close();
    }
  });

  test("EHLO announces the sender's domain, not a hostname the relay cannot parse", async () => {
    const relay = await startRelay();
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: "no-reply@rezepte.test",
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      expect(relay.transcript[0]).toBe("EHLO rezepte.test");
    } finally {
      await relay.close();
    }
  });

  test("sends both parts of a text+html mail, plain text first", async () => {
    const relay = await startRelay();
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      }).send({
        to: "max@beispiel.de",
        subject: "Passwort zurücksetzen",
        text: "Nur Text",
        html: "<p>Mit <b>HTML</b></p>",
      });

      const raw = relay.messages[0] ?? "";
      expect(raw).toContain("Content-Type: multipart/alternative;");
      const textIndex = raw.indexOf('Content-Type: text/plain; charset="UTF-8"');
      const htmlIndex = raw.indexOf('Content-Type: text/html; charset="UTF-8"');
      expect(textIndex).toBeGreaterThan(-1);
      expect(htmlIndex).toBeGreaterThan(textIndex);

      const boundary = /boundary="([^"]+)"/.exec(raw)?.[1] ?? "";
      expect(boundary.length).toBeGreaterThan(10);
      expect(raw).toContain(`--${boundary}--`);
      // Both parts survive the round trip.
      const bodies = raw
        .split(`--${boundary}`)
        .slice(1, 3)
        .map((part) => decodedBody(part.replace(/^\r\n/, "")));
      expect(bodies[0]).toBe("Nur Text");
      expect(bodies[1]).toBe("<p>Mit <b>HTML</b></p>");
    } finally {
      await relay.close();
    }
  });
});

describe("SmtpMailer authentication", () => {
  test("uses AUTH PLAIN with NUL-separated credentials when it is advertised", async () => {
    const relay = await startRelay({ capabilities: ["AUTH PLAIN LOGIN", "HELP"] });
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        user: "postmaster@rezepte.test",
        password: "geheim",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });

      const auth = relay.transcript.find((line) => line.startsWith("AUTH PLAIN "));
      expect(auth).toBeDefined();
      const decoded = Buffer.from((auth ?? "").slice("AUTH PLAIN ".length), "base64").toString(
        "utf8",
      );
      // authzid NUL authcid NUL passwd, with an empty authzid (RFC 4616). A space
      // here instead of a NUL is the classic silent "535 auth failed".
      expect(decoded.split("\u0000")).toEqual(["", "postmaster@rezepte.test", "geheim"]);
    } finally {
      await relay.close();
    }
  });

  test("falls back to AUTH LOGIN when the relay offers only that", async () => {
    const relay = await startRelay({ capabilities: ["AUTH LOGIN", "HELP"] });
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        user: "kueche",
        password: "pw",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });

      expect(relay.transcript).toContain("AUTH LOGIN");
      const user = relay.transcript.find((line) => line.startsWith("AUTH-LOGIN-USER "));
      const password = relay.transcript.find((line) => line.startsWith("AUTH-LOGIN-PASSWORD "));
      expect(Buffer.from((user ?? "").split(" ")[1] ?? "", "base64").toString()).toBe("kueche");
      expect(Buffer.from((password ?? "").split(" ")[1] ?? "", "base64").toString()).toBe("pw");
    } finally {
      await relay.close();
    }
  });

  test("never authenticates when no user is configured (Mailpit)", async () => {
    const relay = await startRelay({ capabilities: ["AUTH PLAIN LOGIN", "HELP"] });
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      expect(relay.transcript.some((line) => line.startsWith("AUTH"))).toBe(false);
    } finally {
      await relay.close();
    }
  });

  test("refuses a relay that only offers a mechanism we cannot speak", async () => {
    const relay = await startRelay({ capabilities: ["AUTH CRAM-MD5 XOAUTH2", "HELP"] });
    try {
      const send = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        user: "u",
        password: "p",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      await expect(send).rejects.toThrow(/CRAM-MD5/);
      expect(relay.messages).toHaveLength(0);
    } finally {
      await relay.close();
    }
  });
});

describe("SmtpMailer TLS", () => {
  test("fails closed when STARTTLS was demanded but is not advertised", async () => {
    // The security-critical branch, and the one that needs no certificate: a relay
    // that does not offer STARTTLS must never receive the credentials in the clear.
    const relay = await startRelay({ capabilities: ["AUTH PLAIN", "HELP"], mode: "plain" });
    try {
      const send = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "starttls",
        user: "postmaster@rezepte.test",
        password: "geheim",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });

      await expect(send).rejects.toThrow(/does not offer STARTTLS/);
      // Nothing beyond the greeting was sent — no AUTH, no envelope, no message.
      expect(relay.transcript.map((line) => line.split(" ")[0])).toEqual(["EHLO"]);
      expect(relay.messages).toHaveLength(0);
    } finally {
      await relay.close();
    }
  });

  test("upgrades with STARTTLS and re-reads the capabilities afterwards", async () => {
    if (!certificate) return; // openssl unavailable — see the file header.
    const relay = await startRelay({
      capabilities: ["AUTH PLAIN", "HELP"],
      mode: "starttls",
      tls: certificate,
    });
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "starttls",
        user: "u",
        password: "p",
        from: FROM,
        allowInsecureTls: true,
      }).send({ to: "a@b.de", subject: "Nach dem Upgrade", text: "verschlüsselt" });

      const verbs = relay.transcript.map((line) => line.split(" ")[0]?.toUpperCase());
      // A SECOND EHLO after STARTTLS is mandatory (RFC 3207 §4.2): the plaintext
      // capability list may have been tampered with and must be discarded.
      expect(verbs).toEqual(["EHLO", "STARTTLS", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
      expect(decodedBody(relay.messages[0] ?? "")).toBe("verschlüsselt");
    } finally {
      await relay.close();
    }
  });

  test("works over implicit TLS (port 465 style)", async () => {
    if (!certificate) return;
    const relay = await startRelay({ mode: "tls", tls: certificate });
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "tls",
        from: FROM,
        allowInsecureTls: true,
      }).send({ to: "a@b.de", subject: "Test", text: "direkt verschlüsselt" });
      expect(decodedBody(relay.messages[0] ?? "")).toBe("direkt verschlüsselt");
    } finally {
      await relay.close();
    }
  });

  test("rejects a self-signed certificate unless it was explicitly allowed", async () => {
    if (!certificate) return;
    const relay = await startRelay({ mode: "tls", tls: certificate });
    try {
      const send = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "tls",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      await expect(send).rejects.toThrow(/self.signed|self signed|SELF_SIGNED/i);
    } finally {
      await relay.close();
    }
  });
});

describe("SmtpMailer failures", () => {
  test("surfaces the relay's status code and reason", async () => {
    const relay = await startRelay({
      failOn: { verb: "RCPT", reply: "550 5.1.1 <a@b.de>: Recipient address rejected" },
    });
    try {
      const send = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      await expect(send).rejects.toThrow(/SMTP 550.*Recipient address rejected/);
    } finally {
      await relay.close();
    }
  });

  test("names host and port when the connection is refused", async () => {
    // Port 1 is never a relay; the message has to say where it tried to go.
    const send = new SmtpMailer({
      host: "127.0.0.1",
      port: 1,
      security: "none",
      from: FROM,
      timeoutMs: 3000,
    }).send({ to: "a@b.de", subject: "Test", text: "x" });
    await expect(send).rejects.toThrow(/127\.0\.0\.1:1/);
  });

  test("gives up on a relay that accepts the connection and then goes quiet", async () => {
    // No greeting is ever written, so only the deadline can end this.
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const send = new SmtpMailer({
        host: "127.0.0.1",
        port,
        security: "none",
        from: FROM,
        timeoutMs: 300,
      }).send({ to: "a@b.de", subject: "Test", text: "x" });
      await expect(send).rejects.toThrow(/timeout|did not respond/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("rejects a recipient that would inject a header, before connecting", async () => {
    const relay = await startRelay();
    try {
      const mailer = new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      });
      await expect(
        mailer.send({ to: "max@beispiel.de\r\nBcc: opfer@beispiel.de", subject: "x", text: "y" }),
      ).rejects.toThrow(/recipient address contains illegal characters/);
      await expect(
        mailer.send({ to: "max@beispiel.de", subject: "Hallo\r\nBcc: opfer@beispiel.de", text: "y" }),
      ).rejects.toThrow(/subject contains illegal characters/);
      // Nothing reached the relay at all.
      expect(relay.transcript).toHaveLength(0);
      expect(relay.messages).toHaveLength(0);
    } finally {
      await relay.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* message construction                                                       */
/* -------------------------------------------------------------------------- */

describe("message construction", () => {
  test("encodes a German subject as RFC 2047 and it decodes back unchanged", async () => {
    const relay = await startRelay();
    const subject = "Passwort zurücksetzen für dein Rezepte-Konto — bitte prüfen";
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      }).send({ to: "a@b.de", subject, text: "x" });

      const raw = relay.messages[0] ?? "";
      const header = headerOf(raw, "Subject");
      expect(header).toContain("=?UTF-8?B?");
      expect(decodeEncodedWords(header)).toBe(subject);
    } finally {
      await relay.close();
    }
  });

  test("splits long encoded subjects on character boundaries, never mid-umlaut", () => {
    const subject = "ä".repeat(60);
    const encoded = encodeHeaderValue(subject);
    expect(encoded.split("\r\n ").length).toBeGreaterThan(1);
    // No encoded word may exceed the 75-character limit …
    for (const word of encoded.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
    // … and the whole thing still decodes to the original, with no U+FFFD.
    const decoded = encoded
      .split("\r\n ")
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(subject);
    expect(decoded).not.toContain("�");
  });

  test("leaves a plain-ASCII header alone", () => {
    expect(encodeHeaderValue("Willkommen bei Rezepte")).toBe("Willkommen bei Rezepte");
  });

  test("encodes only the display name of an address header", () => {
    // Encoding the angle brackets too produces something no relay accepts.
    expect(encodeAddressHeader("Rezepte Küche <no-reply@rezepte.test>")).toBe(
      `${encodeHeaderValue("Rezepte Küche")} <no-reply@rezepte.test>`,
    );
    expect(encodeAddressHeader("Rezepte <no-reply@rezepte.test>")).toBe(
      "Rezepte <no-reply@rezepte.test>",
    );
    expect(encodeAddressHeader("no-reply@rezepte.test")).toBe("no-reply@rezepte.test");
  });

  test("addressOf() strips the display name", () => {
    expect(addressOf("Rezepte <no-reply@rezepte.test>")).toBe("no-reply@rezepte.test");
    expect(addressOf("  bare@rezepte.test ")).toBe("bare@rezepte.test");
  });

  test("dotStuff() doubles a leading dot so it cannot end DATA early", () => {
    expect(dotStuff(".\r\nrest")).toBe("..\r\nrest");
    expect(dotStuff("a\r\n.hidden\r\nb")).toBe("a\r\n..hidden\r\nb");
    expect(dotStuff("no dots here")).toBe("no dots here");
  });

  test("a body that ends in a dot line still arrives intact", async () => {
    // The base64 encoding already makes this impossible, which is the point: the
    // test pins the guarantee rather than the implementation.
    const relay = await startRelay();
    try {
      await new SmtpMailer({
        host: "127.0.0.1",
        port: relay.port,
        security: "none",
        from: FROM,
      }).send({ to: "a@b.de", subject: "Test", text: "Zutaten:\n.\nSchluss" });
      expect(decodedBody(relay.messages[0] ?? "")).toBe("Zutaten:\n.\nSchluss");
    } finally {
      await relay.close();
    }
  });

  test("buildMessage() is deterministic given a date and an id", () => {
    const raw = buildMessage(
      { to: "a@b.de", subject: "Test", text: "hallo" },
      "Rezepte <no-reply@rezepte.test>",
      new Date("2026-08-04T09:30:00Z"),
      "11111111-2222-3333-4444-555555555555",
    );
    expect(raw).toContain("Date: Tue, 04 Aug 2026 09:30:00 +0000");
    expect(raw).toContain("Message-ID: <11111111-2222-3333-4444-555555555555@rezepte.test>");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("Auto-Submitted: auto-generated");
  });
});
