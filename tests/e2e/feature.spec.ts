import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("A proposes a trade by scanning B's payload; B sees the offer and accepts → swap", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    await expect(a.locator(".tc-card .tc-name")).toBeVisible();
    const aliceCardText = (await a.locator(".tc-card .tc-name").textContent()) ?? "";
    const bobCardText = (await b.locator(".tc-card .tc-name").textContent()) ?? "";

    await b.locator(".mesh-qrx-payload summary").click();
    const bp = (await b.locator(".mesh-qrx-payload code").textContent()) ?? "";
    await a.getByPlaceholder("or paste a payload (URL or mesh://)").fill(bp);
    await a.getByRole("button", { name: "use", exact: true }).click();

    await expect(b.locator(".tc-offers")).toContainText("offers their");
    await b.getByRole("button", { name: "accept", exact: true }).click();

    if (aliceCardText !== bobCardText) {
      await expect(a.locator(".tc-card .tc-name")).toHaveText(bobCardText);
      await expect(b.locator(".tc-card .tc-name")).toHaveText(aliceCardText);
    }
  } finally {
    await cleanup();
  }
});
