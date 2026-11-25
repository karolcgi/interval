# Interval design system

Calm, editorial, precise. Closer to a well-made creative tool than a dashboard.
Starting point: the original "Interval" mockup (dark, warm greys, pastel category colours).

## Principles

1. **Colour means category.** Chrome is neutral warm grey. Category colours, the user's accent and the coral
   "now" line are the only hues.
2. **Plan vs reality is legible at a glance.** Planned blocks are dashed outlines with a faint wash. Completed
   blocks are solid. In-progress blocks get a halo. Skipped blocks fade and strike through. Recorded sessions live in
   their own Actual lane as solid bars, striped while running.
3. **Hierarchy through type and space, not boxes.** Few cards (the "Today's time" hero, stats panels). Sections are
   separated by hairlines.
4. **Fast hands.** Every frequent action has a pointer gesture and a key. Creation is drag → key.
5. **Honest numbers.** Only recorded time counts. No scores, no streak guilt.

## Tokens (`src/styles/tokens.css`)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | #17181b | #fbfaf7 | workspace |
| `--surface` | #1e1f23 | #f3f2ee | sidebars |
| `--raised` | #25262a | #ffffff | cards |
| `--border` | #36373b | #e0ded8 | hairlines |
| `--grid` | #26272b | #ecebe6 | hour lines |
| `--text` / `-2` / `-3` / `-4` | #ecece7 → #75767c | #1c1c1e → #9a9aa0 | four text levels |
| `--now` | #e79b8b | #d4604a | current time |
| `--accent` | user-defined, default #d5d3ca | | focus, selection |

Category defaults: Freelance #8298d7 · Studying #8bbca0 · Personal art #ba9ad0 · Creative research #77b3bf ·
Asset development #d49a72 · Administration #c6ae76 · Personal time #9a9ba2 · Breaks #6c6d73.
In light mode category text is mixed 62% with black for contrast (`--c-text`).

Block fills: planned 7%, completed 19% of the category colour over `--bg` (6%/17% in light).

**Type**: Inter Variable (bundled, offline) with tabular numerals; falls back to Segoe UI Variable.
Scale 10 / 11 / 12 / 13 / 15 / 18 / 24 / 30 px. Eyebrow labels: 10 px, uppercase, 0.09em tracking.
**Spacing**: 4 px base (4, 8, 12, 16, 20, 24, 32). **Radius**: 4 / 6 / 8 px, never pill-shaped containers.
**Motion**: 90–160 ms, `cubic-bezier(.2,.7,.2,1)`; popovers rise 3 px; respects reduced motion.
**Density**: `data-density="compact"` tightens type, rows and panel widths.

## Layout

`sidebar 224px | workspace | details panel 280px`, both sides collapsible (`[` and `]`). Under 980 px the
details panel hides. The timeline gutter is 56 px; the Actual lane is min(30%, 180px) in day view.

## Iconography

Lucide, 13–15 px, 1.5–2 px stroke, always paired with text in menus.
