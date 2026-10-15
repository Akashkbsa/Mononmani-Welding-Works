import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(async () => {
  cleanup();
  // A closed Modal leaves a fading copy on the body a moment later; clear it so tests stay apart.
  await Promise.resolve();
  document.querySelectorAll(".mww-ghost").forEach((ghost) => ghost.remove());
});

// jsdom has no matchMedia or scrollIntoView; the dialogs and the searchable select use them.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
