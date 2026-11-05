import { expect, type Page } from "@playwright/test";

export async function openMedia(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Mic & camera",
    exact: true,
  });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}
export async function clickMedia(page: Page, name: string) {
  await openMedia(page);
  await page
    .getByRole("button", {
      name,
      exact: true,
    })
    .click();
}

export async function closeMedia(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Mic & camera",
    exact: true,
  });
  if ((await trigger.getAttribute("aria-expanded")) === "true")
    await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
