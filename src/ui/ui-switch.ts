/** `?ai=nope` swaps the page for the original Rails app's hand-coded look, on the same engine. */
export const OLD_UI = new URLSearchParams(location.search).get("ai") === "nope";

/** The "Pretty AI Version | Old Hand-coded UI" pill: each half reloads the page into that look. */
export function uiSwitch(): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "ui-switch";
  nav.setAttribute("aria-label", "Look");
  for (const [old, label] of [
    [false, "Pretty AI Version"],
    [true, "Old Hand-coded UI"]
  ] as const) {
    const url = new URL(location.href);
    if (old) url.searchParams.set("ai", "nope");
    else url.searchParams.delete("ai");
    const a = document.createElement("a");
    a.href = url.pathname + url.search;
    a.textContent = label;
    if (old === OLD_UI) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  return nav;
}
