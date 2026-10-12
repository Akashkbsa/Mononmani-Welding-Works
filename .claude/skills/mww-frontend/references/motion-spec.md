# Motion spec for this app

The goal is motion that feels **effortless**: things glide in, glide out, and never snap. Smoothness has four ingredients, and each one below is a rule, not a taste:

1. **Soft curves, not sharp ones.** A long, gentle landing on arrival; a short acceleration on exit.
2. **Both directions.** Whatever animates in also animates out. A pop-away spoils a smooth arrival.
3. **GPU-only movement.** Only `transform` and `opacity` move. Nothing that triggers layout or paint is animated, so it stays smooth even while the page is busy loading data.
4. **Connected states.** A marker slides between tabs; a list fades in where its placeholder was; the page fades between screens. Nothing teleports.

What still stays still, because people do it hundreds of times a day: typing, tabbing, keyboard shortcuts, hovering a row beyond a colour change.

Contents:

1. [Tokens](#tokens)
2. [Where motion lives](#where-motion-lives)
3. [How exits work](#how-exits-work)
4. [Loading and the one reveal](#loading-and-the-one-reveal)
5. [Reduced motion](#reduced-motion)
6. [Rules that never bend](#rules-that-never-bend)
7. [Checking your work](#checking-your-work)

## Tokens

Defined once in `src/index.css`. Reuse them; never write a one-off curve or duration.

| Token | Value | Used for |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | everything arriving (soft quint: fast start, long landing) |
| `--ease-in` | `cubic-bezier(0.5, 0, 0.75, 0)` | everything leaving (accelerates away) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | things that travel across the screen (tab marker, shimmer) |
| `--dur-press` | 120 ms | button press |
| `--dur-hover` | 160 ms | colour and shadow on hover |
| `--dur-popover` | 200 ms | menus and pick lists in |
| `--dur-dialog` | 260 ms | dialogs and their veil in |
| `--dur-toast` | 280 ms | toasts in |
| `--dur-page` | 180 ms | page and list fade |
| `--dur-reveal` | 440 ms | the one dashboard reveal |
| `--dur-exit` | 160 ms | anything leaving |
| `--dur-slide` | 300 ms | the tab marker |
| `--dur-highlight` | 900 ms | the "just saved" glow |

Measured curves (sampled in headless Edge): a dialog reaches 91% opacity by 100 ms and settles at 200 ms; it leaves in 160 ms; the tab marker eases in and out with a 300 ms S-curve.

## Where motion lives

| Piece | Class | Motion |
|---|---|---|
| Buttons | `.mww-btn` | `scale(0.98)` press, soft colour change |
| Dialog veil and card | `.mww-backdrop`, `.mww-dialog` | veil fades; card fades and rises 12 px. **No scaling** (scaling a card full of text re-sharpens it at the end, which looks like a shimmer) |
| Menus, pick list | `.mww-popover` | grows from its control (`--popover-origin`), scale 0.97 and a 2 px drop; shrinks back on close |
| Toast | `.mww-toast` | rises 12 px and fades in; sinks and fades out |
| Page change | `.mww-page` | fade in (180 ms), no movement |
| Table after loading | `.mww-fade` | fades in where the skeleton was |
| Tab underline | `.mww-slider` | one marker that slides and stretches between tabs (`translateX` + `scaleX`) |
| Sidebar active page | transition on `box-shadow`, `background-color`, `color` | the orange marker and highlight cross-fade |
| Saved invoice row | `.mww-flash` | arc glow that fades over 900 ms |
| Dashboard, first load of a session | `.mww-reveal` | blocks rise and fade in with 70 ms between them, once per session |
| Skeleton | `.mww-skeleton` | a light sweep that is a moving layer (`transform`), never a moving background |

Use CSS keyframes for enter (they work on every WebView2 version) and CSS transitions only for things that toggle back and forth (buttons, tab marker).

## How exits work

React removes things instantly, so exits need help. The app has three small tools, all in `src/components/ui.tsx`:

- **`Modal` leaves a ghost.** When any dialog is removed, by any route (Escape, X, Cancel, Save), a see-through copy stays in `document.body` for 160 ms and fades away, then deletes itself. It cannot be clicked or focused (`inert`, `aria-hidden`, `pointer-events: none`). Nothing in the parents needs to change. It is skipped under reduced motion.
- **`usePresence(open, ms)`** keeps a menu or list mounted for `ms` after it closes and reports `closing`; mark the element `data-state="closed"` while closing and the `.mww-popover` / `.mww-toast` classes play the exit.
- **Toast** holds, flips to `data-state="closed"`, then unmounts 180 ms later.

When you add something new that opens and closes, give it an exit through one of these. Do not add a new mechanism.

## Loading and the one reveal

Lists show skeleton rows shaped like the real rows; when data arrives the table fades in (`.mww-fade`). The dashboard shows a skeleton of its strip and cards, then on the **first load of a session only** the blocks rise in with a small stagger (`dashboardRevealed` flag). Returning to the dashboard or reloading its data after a save never replays it. Money figures never count up: tickers delay reading and are wrong for accounts.

## Reduced motion

One global rule in `src/index.css` collapses every animation and transition to near zero and stops the shimmer. Meaningful state changes (a colour, an error) stay visible. Note for support: Windows has a switch, **Settings > Accessibility > Visual effects > Animation effects**. When it is off, WebView2 asks the app for reduced motion and the whole app is deliberately static. If motion ever "does not work" on one computer, check that first.

## Rules that never bend

- Only `transform` and `opacity` move. (Colour and shadow may change on hover. The skeleton sweep, tab marker, dialogs and menus use transform only.)
- Never start from `scale(0)`; menus start at 0.97, dialogs do not scale.
- Entering uses `--ease-out`; leaving uses `--ease-in`; travelling uses `--ease-in-out`. Never `transition: all`.
- Keyboard-initiated actions and typing never animate.
- No parallax, scroll hijack, marquee, custom cursors, or infinite loops (except the loading shimmer and spinner).
- `will-change` only while something is animating.
- No animation library. CSS and a few lines of React are enough.

## Checking your work

1. **Read the curve, not just the picture.** Seek each animation to exact times with the Web Animations API (`el.getAnimations()`, `a.pause()`, `a.currentTime = t`) in headless Edge and read the computed `opacity` and `transform`. The values should change a little at the start, move fastest early (arrivals) or late (exits), end exactly at rest, and never jump.
2. **Spam it.** Open and close a dialog repeatedly, scrub between tabs quickly, hover rapidly across rows. Nothing should stack, flash or jump.
3. **Reduced motion.** Confirm everything collapses to instant.
4. **Real hardware.** The numbers above prove the curves, not frame rate on a slow PC. Ask the user to try the heaviest dialog (new invoice) on their machine.
