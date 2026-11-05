import { expect, type Locator, type Page } from "@playwright/test";

async function inCourt(locator: Locator) {
  return locator.evaluate((node) => {
    const field = node.getBoundingClientRect();
    const court = node.closest(".app")!.getBoundingClientRect();
    return field.top >= court.top && field.bottom <= court.bottom;
  });
}

/** Synthetic resize contract only: physical keyboards and pinch zoom need devices. */
export async function checkKeyboardViewport(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Join a friend", exact: true })
    .click();
  const argument = page.getByLabel("Your name", { exact: true });
  const side = page.getByLabel("Room code", { exact: true });
  const action = page.getByRole("button", { name: "Join room", exact: true });
  const keyboardHeight = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--keyboard-height"),
    );
  const resize = async (height: number, scale = 1) =>
    page.evaluate(
      ({ height, scale }) => {
        Object.defineProperty(window.visualViewport!, "height", {
          configurable: true,
          value: height,
        });
        Object.defineProperty(window.visualViewport!, "scale", {
          configurable: true,
          value: scale,
        });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      },
      { height, scale },
    );

  try {
    expect(
      await argument.evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe("16px");
    await argument.fill("Alex");
    await resize(400);
    await expect.poll(keyboardHeight).toBe("400px");
    // No scrollIntoView call here: the application must reveal the focused field.
    await expect.poll(() => inCourt(argument)).toBe(true);
    await expect(argument).toBeFocused();

    await side.fill("2048");
    await expect.poll(() => inCourt(side)).toBe(true);
    await expect(side).toBeFocused();

    // Reach the action through ordinary scrolling, without locator auto-scrolling.
    const court = await page.locator(".app").boundingBox();
    await page.mouse.move(
      court!.x + court!.width / 2,
      court!.y + court!.height / 2,
    );
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => inCourt(action)).toBe(true);
    await expect(action).toBeEnabled();
    const button = await action.boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(400);

    // The hook must stop constraining the shell while browser zoom is active.
    await resize(400, 2);
    await expect.poll(keyboardHeight).toBe("");
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(2);
    await resize(400);
    await expect.poll(keyboardHeight).toBe("400px");
    await argument.focus();
    await expect.poll(() => inCourt(argument)).toBe(true);

    await resize(844);
    await expect.poll(keyboardHeight).toBe("");
    await expect
      .poll(() =>
        page
          .locator(".app")
          .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
      )
      .toBe(844);
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height");
      Reflect.deleteProperty(window.visualViewport!, "scale");
      (document.activeElement as HTMLElement)?.blur();
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await page
      .getByRole("button", { name: "Create your own room", exact: true })
      .click();
  }
}
