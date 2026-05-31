import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

// Read the QR payload one peer publishes (the same string a camera would decode).
async function payloadOf(page: import("@playwright/test").Page): Promise<string> {
  await page.locator(".mesh-qrx-payload summary").click();
  return (await page.locator(".mesh-qrx-payload code").textContent()) ?? "";
}

// Drive the advertised core action: scan the other peer's QR. We feed the
// decoded payload through the same parse path the camera would hit.
async function scan(page: import("@playwright/test").Page, payload: string) {
  await page.getByPlaceholder("or paste a payload (URL or mesh://)").fill(payload);
  await page.getByRole("button", { name: "use", exact: true }).click();
}

test("each peer is dealt a distinct card", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await expect(a.locator(".tc-card .tc-name")).toBeVisible();
    await expect(b.locator(".tc-card .tc-name")).toBeVisible();
    const aCard = (await a.locator(".tc-card .tc-name").textContent()) ?? "";
    const bCard = (await b.locator(".tc-card .tc-name").textContent()) ?? "";
    expect(aCard).not.toBe("");
    expect(aCard).not.toBe(bCard);
  } finally {
    await cleanup();
  }
});

test("a one-sided confirm does NOT swap cards", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await expect(a.locator(".tc-card .tc-name")).toBeVisible();
    await expect(b.locator(".tc-card .tc-name")).toBeVisible();
    const aCardBefore = (await a.locator(".tc-card .tc-name").textContent()) ?? "";
    const bCardBefore = (await b.locator(".tc-card .tc-name").textContent()) ?? "";

    // Only A confirms (scans B's QR). B never confirms.
    await scan(a, await payloadOf(b));

    // The pending trade must surface on BOTH screens, showing it is awaiting
    // B's confirmation — but NO card may move while only one side confirmed.
    await expect(a.locator(".tc-trade")).toContainText("you ✓");
    await expect(b.locator(".tc-trade")).toContainText("them ✓");

    // Cards must be unchanged on both screens after a one-sided confirm.
    await expect(a.locator(".tc-card .tc-name")).toHaveText(aCardBefore);
    await expect(b.locator(".tc-card .tc-name")).toHaveText(bCardBefore);
  } finally {
    await cleanup();
  }
});

test("mutual confirm swaps the cards identically on BOTH screens", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await expect(a.locator(".tc-card .tc-name")).toBeVisible();
    await expect(b.locator(".tc-card .tc-name")).toBeVisible();
    const aCardBefore = (await a.locator(".tc-card .tc-name").textContent()) ?? "";
    const bCardBefore = (await b.locator(".tc-card .tc-name").textContent()) ?? "";
    expect(aCardBefore).not.toBe(bCardBefore);

    // A confirms by scanning B's QR.
    await scan(a, await payloadOf(b));
    await expect(b.locator(".tc-trade")).toContainText("them ✓");
    // Still no swap (only A confirmed).
    await expect(a.locator(".tc-card .tc-name")).toHaveText(aCardBefore);

    // B confirms by scanning A's QR → mutual confirm → swap.
    await scan(b, await payloadOf(a));

    // The swap must land on BOTH peers' own card view, and they must be
    // mirror images: A now holds B's old card and vice-versa.
    await expect(a.locator(".tc-card .tc-name")).toHaveText(bCardBefore);
    await expect(b.locator(".tc-card .tc-name")).toHaveText(aCardBefore);

    // And the shared "all holdings" view agrees on both screens: alice now
    // shows bob's old card, bob shows alice's old card.
    await expect(a.locator(".tc-holdings")).toContainText(bCardBefore);
    await expect(b.locator(".tc-holdings")).toContainText(aCardBefore);
  } finally {
    await cleanup();
  }
});
