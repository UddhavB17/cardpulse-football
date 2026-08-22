import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createChaosServer } from "./server.js";

const openServers: ReturnType<typeof createChaosServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startServer() {
  const server = createChaosServer();
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function setMode(baseUrl: string, mode: string): Promise<Response> {
  return fetch(`${baseUrl}/__control`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ mode }),
  });
}

describe("chaos source HTTP server", () => {
  it("serves baseline table markup on the stable /players target", async () => {
    const baseUrl = await startServer();
    const baseline = await fetch(`${baseUrl}/players`);
    expect(baseline.status).toBe(200);
    expect(baseline.headers.get("content-type")).toContain("text/html");
    const html = await baseline.text();
    expect(html).toContain('data-layout="table"');
    expect(html).toContain('data-table="players"');
    expect(html).toContain("Finn Krüger");
    expect(html).toContain("18");
  });

  it("switches to structurally changed card markup with the same valid data", async () => {
    const baseUrl = await startServer();
    const control = await setMode(baseUrl, "drift-cards");
    expect(control.status).toBe(200);
    expect(await control.json()).toEqual({
      mode: "drift-cards",
      publicTarget: "/players",
    });

    const cards = await (await fetch(`${baseUrl}/players`)).text();
    expect(cards).toContain('data-layout="cards"');
    expect(cards).not.toContain('data-layout="table"');
    expect(cards).not.toContain("<table");
    expect(cards).toContain("Finn Krüger");
    expect(cards).toContain("18");
  });

  it("amended-stats keeps the card layout but changes a real stat value", async () => {
    const baseUrl = await startServer();
    await setMode(baseUrl, "drift-cards");
    const drifted = await (await fetch(`${baseUrl}/players`)).text();

    await setMode(baseUrl, "amended-stats");
    const amended = await (await fetch(`${baseUrl}/players`)).text();

    expect(amended).toContain('data-layout="cards"');
    expect(amended).toContain("21");
    expect(drifted).toContain("18");
    expect(drifted).not.toContain("21");
  });

  it("preserves deterministic JSON separately from the public HTML", async () => {
    const baseUrl = await startServer();
    const response = await fetch(
      `${baseUrl}/fixtures/records?mode=drift-cards`,
    );
    const body = (await response.json()) as {
      mode: string;
      items: Array<{ entityType: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("drift-cards");
    expect(body.items.length).toBeGreaterThan(0);

    await setMode(baseUrl, "amended-stats");
    const sameFixture = await fetch(
      `${baseUrl}/fixtures/records?mode=drift-cards`,
    );
    expect(await sameFixture.json()).toEqual(body);
  });

  it("returns a deterministic 503 without changing the public URL", async () => {
    const baseUrl = await startServer();
    await setMode(baseUrl, "unavailable");

    const response = await fetch(`${baseUrl}/players`);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Temporarily unavailable");
  });

  it("rejects unsupported control modes without changing state", async () => {
    const baseUrl = await startServer();
    const response = await setMode(baseUrl, "surprise-mode");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "unsupported_mode",
      supportedModes: [
        "baseline-table",
        "drift-cards",
        "amended-stats",
        "unavailable",
      ],
    });

    const publicPage = await fetch(`${baseUrl}/players`);
    expect(await publicPage.text()).toContain('data-layout="table"');
  });

  it("reports the current mode through the separate control route", async () => {
    const baseUrl = await startServer();
    await setMode(baseUrl, "drift-cards");

    const response = await fetch(`${baseUrl}/__control`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("drift-cards — current");
  });

  it("applies security headers and returns 405 for unsupported methods", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/players`, { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("returns 405 for unsupported control methods and 404 for unknown routes", async () => {
    const baseUrl = await startServer();
    const unsupported = await fetch(`${baseUrl}/__control`, {
      method: "DELETE",
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, POST");

    const unknown = await fetch(`${baseUrl}/missing`);
    expect(unknown.status).toBe(404);
  });
});
