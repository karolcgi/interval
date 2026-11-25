// v0.7 navigation: primary views are top tabs; the rest sit in the "More" menu.
const PRIMARY = ["Today", "Calendar", "Statistics", "Presets", "Template"];
const ALIASES = { Categories: "Categories & tags" };

export async function nav(page, label) {
  const name = ALIASES[label] ?? label;
  if (PRIMARY.includes(name)) return page.locator(".topbar .tab", { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator(".topbar .tab-more").click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`) }).click();
}
