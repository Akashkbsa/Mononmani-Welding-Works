# Motion spec for this app

The app is used all day for repetitive work, so the rule is Emil Kowalski's **frequency rule**: the more often someone does it, the less it should animate. Motion here exists to explain a change (something opened, moved, appeared, finished), never to decorate. If you cannot say what an animation communicates in one sentence, remove it.

Contents:

1. [Frequency table](#frequency-table)
2. [Tokens](#tokens)
3. [Component recipes](#component-recipes)
4. [The one orchestrated moment](#the-one-orchestrated-moment)
5. [Loading states](#loading-states)
6. [Reduced motion](#reduced-motion)
7. [Rules that never bend](#rules-that-never-bend)
8. [Checking your work](#checking-your-work)

## Frequency table

| What | How often | Motion |
|---|---|---|
| Switching sidebar pages, typing, tabbing, `/` and Ctrl+N shortcuts, keyboard row navigation | hundreds of times a day | **None.** Instant. |
| Hover on rows, buttons, tabs | tens of times a day | Colour or background change only, 100 to 150 ms. No movement. |
| Pressing a button | tens of times a day | `scale(0.98)` on `:active`, 80 to 100 ms. |
| Opening a dialog, the Print menu, the customer pick list, confirm dialogs | occasional | Quick fade plus a small scale from `0.97`, origin-aware for menus. 120 to 180 ms. |
| Toast appearing and leaving | occasional | Fade and 8 px rise; leaves faster than it arrives. |
| Tab underline changing | occasional | Slide between tabs, 160 ms. |
| Status or total changing after a save | occasional | A brief highlight of the changed value (background fades from a soft tint over 600 ms), no movement. |
| First dashboard load of a session | rare | One gentle staggered reveal (see below). |
| Backup finished, restore finished | rare | A calm confirmation; one check mark draw is acceptable. |

## Tokens

Put these in `src/index.css` once (`@theme` for CSS variables) and reuse them everywhere. Do not invent per-component curves.

```css
:root {
  /* Strong ease-out: instant feedback, soft landing. Built-in `ease-out` is too weak. */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  /* For things that move on screen (tab underline, reordering). */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --dur-press: 90ms;
  --dur-hover: 120ms;
  --dur-popover: 140ms;
  --dur-dialog: 180ms;
  --dur-exit: 110ms;      /* leaving is faster than arriving */
  --dur-highlight: 600ms;
}
```

Never `ease-in` for UI. Never `transition: all`; name the properties. Keep everything under 300 ms except the one-time highlight and the dashboard reveal.

## Component recipes

Prefer CSS transitions (interruptible) over keyframes for anything that can be toggled quickly. Use `@starting-style` for enter states so no JS is needed.

**Modal** (`ui.tsx` Modal): backdrop fades `0 → 1`; dialog enters from `opacity 0, scale 0.97, translateY(4px)` to rest, `--dur-dialog` with `--ease-out`. It never starts from `scale(0)`. It stays centred (modals are not origin-aware). Exit is `--dur-exit`. Because unmounting kills exit animations, keep a short `closing` state before calling `onClose`, or accept an enter-only animation: enter-only is fine and simpler.

```css
.modal-dialog {
  transition: opacity var(--dur-dialog) var(--ease-out), transform var(--dur-dialog) var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(4px) scale(0.97); }
}
.modal-backdrop {
  transition: opacity var(--dur-dialog) var(--ease-out);
  @starting-style { opacity: 0; }
}
```

**Menus and pick lists** (Print menu, `SearchSelect` list): origin is the trigger. Right-aligned menu uses `transform-origin: top right`; the pick list `top left`. Enter from `opacity 0, scale 0.96`, `--dur-popover`. Second and later opens while one is already open in the same group: skip the animation.

**Toast:** enter from `opacity 0, translateY(8px)`, `--dur-dialog`; exit `--dur-exit` with `opacity` only. Replacing a toast must not stack a second animation on the first.

**Buttons:** `transition: transform var(--dur-press) var(--ease-out), background-color var(--dur-hover) ease, box-shadow var(--dur-hover) ease; :active { transform: scale(0.98) }`. Disabled buttons do not press.

**Table rows:** `transition: background-color var(--dur-hover) ease`. The chevron changes colour only. No row movement.

**Tabs (Invoices filter):** the active underline is one absolutely positioned element that slides under the tab (`transform: translateX(...)`, `--dur-popover`, `--ease-in-out`). Counts change without animation.

**Disclosure ("Delivery details"):** height animates through `grid-template-rows: 0fr → 1fr` with `opacity`, `--dur-dialog`. The chevron rotates 90 degrees in the same time.

**Field errors:** appear with `opacity` and a 2 px downward settle, `--dur-hover`; no shake.

**Highlight on change:** after saving, the changed row or total gets a soft brand tint that fades out over `--dur-highlight`. Implement with a CSS class added for one animation cycle; remove it on `animationend`.

## The one orchestrated moment

On the first dashboard load of a session only, reveal the three-figure strip and the two lists with a short stagger: each block `opacity 0 → 1` and `translateY(6px) → 0`, `--dur-dialog`, `--ease-out`, 40 ms between blocks, total under 350 ms. Guard it with a module-level flag so returning to the dashboard or reloading data after a save never replays it. Money figures do not count up: tickers delay reading and are wrong for accounts.

## Loading states

Replace bare "Loading…" in lists with skeleton rows that match the final row heights so nothing jumps. Shimmer is a slow `background-position` sweep on a pseudo-element (transform/opacity only where possible), paused under reduced motion. Buttons that start a long task (PDF, backup) show the spinner inside the button and keep their width.

## Reduced motion

Global rule, once:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Keep state changes that carry meaning (a colour tint, a visible error) instant rather than removing them. Shimmer and highlight fades become static tints.

## Rules that never bend

- Animate only `transform` and `opacity` for movement; colours and background colours are fine for hover. Never animate `width`, `height`, `top`, `left`, `margin`. (The disclosure uses the `grid-template-rows` technique, which is the one allowed exception.)
- Nothing starts from `scale(0)`; start at `0.95` to `0.97` with opacity.
- Interrupting must not jump: use transitions, not keyframes, for toggled UI.
- No parallax, no scroll hijack, no marquee, no infinite loops except the loading shimmer and spinner, no custom cursors.
- No animation on anything triggered from the keyboard.
- `will-change` only on elements that animate right now, and remove it after.
- Do not add an animation library for any of the above. CSS is enough.

## Checking your work

1. Slow it down: temporarily set `--dur-*` to 5x and watch each animation; it should still look right.
2. Spam it: open and close the dialog quickly, hover rapidly across rows; nothing should stack, flash or jump.
3. Reduced motion: toggle the OS setting (or the DevTools emulation) and confirm everything is instant.
4. Frame cost: no layout properties animating; check with the performance panel if anything feels heavy. See the `animation-performance` skill for diagnosis.
5. Ask the "one sentence" question for every animation you added and keep the list for the report.
