# Mononmani Welding Works: brand and interface guide

The app's look is called **Arc and Steel**. It comes from the trade: steel is the work, the arc is the heat that joins it. The interface is a calm, dense work tool for a small workshop, so the brand lives in a few precise details and never in decoration.

## The idea

- **Steel** is structure and trust: cool blue-grey surfaces, steel-blue actions, a forge-dark sidebar. It carries almost everything.
- **Arc** (weld orange) is the heat. It is used only where it means something, and nowhere else:
  1. the logo mark
  2. the marker beside the active page in the sidebar
  3. the figure for **money still owed** (the "Balance due" tile)
  4. the brief glow on something that was **just saved**
  5. the tick in a success message
- If a new use of orange is not on that list, it is probably decoration. Leave it out.

## The mark

`src/components/BrandMark.tsx`. An "M" drawn as one continuous weld bead on an arc-orange tile, with a few sparks thrown off the last stroke. Plain geometry, so it stays crisp at any size. Next to it, the name is set in two lines: **Mononmani** and *Welding Works*. The business name is always spelled "Mononmani Welding Works".

## Colour (tokens in `src/index.css`)

| Role | Token | Value | Use |
|---|---|---|---|
| Primary | `brand-600` | `#2c5878` | buttons, selected tab, links |
| Primary tints | `brand-50` / `100` / `200` | `#eef3f7` / `#dbe5ee` / `#b8cadb` | hover, icon tiles, soft fills |
| Primary dark | `brand-700` / `800` | `#234861` / `#1a374b` | hover and pressed |
| Forge ink | `ink-900` / `800` / `700` | `#121b25` / `#19232f` / `#232f3d` | sidebar, toast |
| Arc | `arc-500` | `#e8731a` | logo, active marker |
| Arc tints | `arc-50` / `100` / `400` / `600` | `#fff5ec` / `#ffe5d0` / `#f58f45` / `#c45a0b` | owed tile, saved glow, success tick |
| Canvas | `canvas` | `#f2f4f7` | page background |

Status colours stay universal and are never used for decoration: green for paid, amber for unpaid, steel for part paid, red for danger, grey for draft and cancelled.

## Type

**IBM Plex Sans**, an engineering typeface with clear digits and a proper rupee sign, bundled in `src/assets/fonts/` (SIL Open Font License, licence text alongside) so the app stays fully offline. Segoe UI is the fallback. Weights used: 400 body, 500 emphasis and labels, 600 titles.

Page titles 20px semibold with slightly tight tracking; section titles 14px semibold; table headings 12px semibold; body 14px. All money uses tabular digits and is right-aligned. No all-caps labels. Plex is a little wider than Segoe UI, so give rows room or truncate with a tooltip.

## Shape and depth

One scale: controls and badges 6px, cards and dialogs 8px. One quiet card shadow. No gradients, no decorative lines.

## Motion

Motion should feel effortless: things glide in, glide out and never snap. Soft curves, an exit for everything that has an entrance, and only transform and opacity move (so it stays smooth on any PC). Typing, tabbing and keyboard shortcuts never animate. Details and measured curves are in `.claude/skills/mww-frontend/references/motion-spec.md`.

| Where | Motion |
|---|---|
| Buttons | tiny soft press |
| Dialogs | the veil fades while the card fades and rises a few pixels (260 ms); on close a copy fades and sinks away (160 ms) |
| Menus and pick lists | grow from the control that opened them and shrink back into it |
| Toasts | rise in, sink out |
| Pages and freshly loaded lists | fade in |
| Tab underline | one marker that glides between tabs |
| Sidebar active page | the orange marker cross-fades |
| Lists while loading | placeholder rows with a soft light sweep |
| Dashboard, first load of a session | one gentle staggered reveal, never again that session |
| A just-saved invoice | a short arc glow on its row |

Everything respects the system "reduce motion" setting. On Windows that follows **Settings > Accessibility > Visual effects > Animation effects**: if it is off, the app is deliberately still.

## Voice

Plain workshop language, sentence case, one name per action across the whole flow ("Record payment", then "Payment recorded"). Errors say what happened and what to do. Empty states say what to do next.

## Rules for new screens

1. Reach for the shared parts in `src/components/ui.tsx` first.
2. Money is right-aligned with tabular digits; dates are `DD-MM-YYYY`.
3. Every list has loading, empty and error states.
4. Every row that opens something can be opened with the keyboard.
5. One accent. One radius scale. Orange only where this guide says.
