---
name: Riona
description: A measured instrument for a services firm's ledger; paper, olive ink and one signal orange.
colors:
  paper: "#F7F7F2"
  surface: "#FDFDF9"
  hover-wash: "#F1F2EA"
  segment-well: "#EEEFE7"
  olive-ink: "#252823"
  ink-2: "#3B3F37"
  ink-3: "#575B52"
  muted: "#676A61"
  placeholder: "#6F7268"
  faint: "#8D9184"
  hairline: "#DFE1D7"
  hairline-input: "#D3D6CA"
  hairline-strong: "#C3C7B8"
  signal-orange: "#D4421F"
  signal-orange-press: "#B9361A"
  mark-orange: "#EF582E"
  sage: "#C6D0B7"
  status-green: "#557A3E"
  status-amber: "#A86F12"
  status-red: "#B4232F"
  dark-field: "#272D22"
  dark-field-text: "#F1F3EA"
  dark-field-muted: "#A0AC92"
  dark-field-line: "#3D4337"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(44px, 6.1vw, 76px)"
    fontWeight: 550
    lineHeight: 1.04
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(30px, 3.4vw, 43px)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.045em"
  page-title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(34px, 4.2vw, 48px)"
    fontWeight: 550
    lineHeight: 1.04
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  metric:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\" 1"
  caption:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  cell: "2px"
  tight: "3px"
  control: "4px"
  card: "6px"
  modal: "8px"
spacing:
  page-gutter: "clamp(20px, 4vw, 48px)"
  section: "clamp(56px, 7vw, 88px)"
  grid-gap: "16px"
  column-gap: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    padding: "13px 18px"
  button-primary-hover:
    backgroundColor: "{colors.signal-orange-press}"
  button-line:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.olive-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.olive-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px 22px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.modal}"
    padding: "28px"
  segmented:
    backgroundColor: "{colors.segment-well}"
    rounded: "{rounded.control}"
    padding: "3px"
  segmented-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.olive-ink}"
    rounded: "{rounded.tight}"
  dark-field:
    backgroundColor: "{colors.dark-field}"
    textColor: "{colors.dark-field-text}"
    rounded: "{rounded.card}"
---

# Design System: Riona

## Overview

**Creative North Star: "The Annotated Ledger"**

Riona is drawn like a technical figure on warm paper. One timesheet entry is the protagonist; every number on screen is shown with where it came from, and the interface reads as a measured instrument rather than a dashboard. The public site, sign-in, the internal app and the client portal share one world: paper (#F7F7F2), olive-black ink, hairlines, and a single signal orange that means action or selection.

Density is moderate and calm. Structure comes from 1px hairlines, not fills or shadows: the public site sits inside a frame of vertical hairlines with small "+" crosshairs where each section rule meets the frame, and the app uses hairline-bordered cards on paper. Geist carries every heading and label a person reads; IBM Plex Mono is reserved for the machine layer (IDs, units, figures, captions, annotations).

This world replaces the earlier "Nordic Futurism" plum and violet system. Nothing glows. The glowing dark hero and the icon-tile hub grid are rejected; hubs read as columns divided by hairlines.

**Key Characteristics:**
- Warm paper ground, olive-black ink, one signal orange used sparingly.
- Hairline frame with "+" crosshairs on the public site; hairline-bordered cards in the app.
- Geist 500 to 550 headings with tight negative tracking; Plex Mono only for data and captions.
- Status is a 6 to 7px dot plus text, never a pill.
- One dark olive field, used twice.
- Figures are drawn (isometric slabs, leader lines, mono annotations), captioned "FIG. 0n".

## Colors

A near-monochrome olive palette on warm paper, with one orange that does all the pointing.

### Primary
- **Signal Orange** (signal-orange): the only colour that carries white text (6:1). Primary buttons, focus rings, caret, selected tab underlines, checkbox and range accents, the "Coming" tag. Pressed/hover state deepens to Signal Orange Press.
- **Mark Orange** (mark-orange): drawing only. The top face of the brand mark, the entry slab in FIG. 01, active nav underlines, unread dots, the payroll-history track fill, today's heat cell ring. Never body text, never under white text.

### Secondary
- **Sage** (sage): the quiet second chart colour and the dark field's secondary text and timeline pins. Chart ramps run sage-olive (#D9E0CC to #2F3A24), ember (#F8D3C3 to #722812) and mono (#DCDED4 to #2B2E27).

### Neutral
- **Paper** (paper): the page ground everywhere, including the theme-color meta.
- **Surface** (surface): cards, inputs, menus, modals; a half-step brighter than paper.
- **Olive Ink** (olive-ink): headings, body, the lower face of the mark, primary data. Ink 2 and Ink 3 step down for secondary copy and descriptions.
- **Muted** (muted): meta text, captions, table support text (4.6:1 on paper).
- **Placeholder** (placeholder): placeholder text, kept at 4.5:1 or better because placeholders are read.
- **Faint** (faint): crosshairs, separators and decoration only; never text.
- **Hairline** (hairline), **Hairline Input** (hairline-input), **Hairline Strong** (hairline-strong): section rules and card borders; control borders; hover borders and chart baselines.
- **Dark Field** (dark-field) with its text, muted and line tokens: the single dark surface.

### Status
- **Green** (status-green), **Amber** (status-amber), **Red** (status-red). Informational status ("In progress", "Sent", "Submitted") reads as ink (#575B52), not a fifth hue. Unknown status falls back to faint grey.

### Named Rules
**The Two Oranges Rule.** #D4421F carries white text; #EF582E is for marks and drawing only. Never swap them.

**The Red Means Over Rule.** Red appears only when something is past a limit (overdue, breached, rejected, below reorder). Informational status is ink. Red stays visibly distinct from the brand orange.

**The One Dark Field Rule.** #272D22 appears in exactly two places: the entry editor's code panel and the payroll history section. No other dark sections, no dark mode hero.

## Typography

**Display Font:** Geist (with system-ui, sans-serif), weights 400 to 650 loaded
**Body Font:** Geist
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace), weights 400 and 500

**Character:** Geist at 500 to 550 with tight negative tracking reads engineered and calm; Plex Mono beside it reads like the annotation layer of a drawing.

### Hierarchy
- **Display** (550, clamp 44 to 76px, 1.04, -0.055em): the public hero headline only.
- **Headline** (500, clamp 30 to 43px, 1.12, -0.045em): public section headings. A trailing clause may drop to a quiet grey (#8A8F80).
- **Page title** (550, clamp 34 to 48px, 1.04, -0.045em): app and portal page headers.
- **Title** (550, 15 to 17px, -0.01 to -0.02em): card, column and dialog titles.
- **Lead** (400, 16.5px, 1.7): hero and page intros, max 34em.
- **Body** (400, 14px app / 14.5 to 15px site, 1.45 to 1.7): running text; long answers cap at 64ch.
- **Metric** (500, 24 to 34px, tabular numerals): metric cards, bands, figure values.
- **Caption** (Plex Mono 500, 11px, 0.08em, uppercase): figure captions and table column heads.
- **Data** (Plex Mono 400, 11 to 13.5px): IDs, units, dates on rows, arithmetic, keyboard hints.

### Named Rules
**The Machine Layer Rule.** Mono is only for data, IDs, units, figure captions and annotations. Never on buttons, nav, headings or sentences a person reads as prose.

**The Caption Not Kicker Rule.** No eyebrow or kicker above a heading. Section numbering lives in figure captions that read "FIG. 01", "FIG. 02", placed with the figure.

**The 11px Floor Rule.** No text below 11px. All numbers use tabular figures.

## Layout

The public site is one centred frame (max 1280px) bounded by 1px hairlines left and right, with faint outer guides at the viewport. Sections are separated by full-width rules; each rule carries a 9px "+" crosshair at both frame edges. Inner gutters are clamp(20px, 3.8vw, 48px); sections breathe clamp(56px, 7vw, 88px) top and bottom. The hero is a two-column grid (copy left, FIG. 01 right) that stacks at 980px; the statutory strip runs six columns down to three and two. Hub and module lists are hairline-divided columns, not tiles.

The app uses a 64px fixed top bar with centred nav and a 1280px content wrap (gutter clamp(20px, 4vw, 48px)). Metric and module grids use auto-fit with 16px gaps; two-column body splits use flex-wrap with 48px gaps. Tables become card lists below 640px. Breakpoints observed: 520, 560, 640, 860, 900, 980, 1000px.

## Elevation & Depth

Flat by default; depth is drawn with hairlines and tone, not shadow. Cards sit on paper with a 1px hairline and change only their border on hover. Shadows exist only on things that float above the page (menus, popovers, the palette, modals, toasts, the bulk bar) and are long, soft and olive-tinted. Primary buttons carry a 1px inner highlight.

### Shadow Vocabulary
- **Menu** (`box-shadow: 0 24px 48px -16px rgba(37, 40, 35, 0.2)`): dropdowns, pickers, column chooser.
- **Overlay** (`box-shadow: 0 40px 80px -24px rgba(37, 40, 35, 0.4)`): command palette and modals.
- **Segment lift** (`box-shadow: 0 1px 2px rgba(37, 40, 35, 0.08)`): the active option in a segmented control.
- **Button highlight** (`box-shadow: 0 1px 1px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.15)`): primary buttons.

### Named Rules
**The No Glow Rule.** No coloured shadows, glows or blurred halos. Focus is a 2px signal-orange outline offset 2 to 3px.

## Shapes

Near-square. Controls (buttons, inputs, selects, segmented wells) are 4px; small inner buttons and segment options 3px; cards, tables, figures and the dark field 6px; modals, the palette and popovers 8px. Heat cells and legend swatches are 2px. Status dots and avatars are the only circles. Bars in charts are nearly square-ended (1px). The brand mark is two stacked rhombuses: an orange one resting on an ink one, drawn in SVG.

## Components

### Buttons
Near-square and direct, with an arrow (↗ or →) where the button goes somewhere.
- **Shape:** squared (4px).
- **Primary:** Signal Orange with white 550-weight text, 13 to 14px, 40px tall in the app, 13px 18px padding on the site; inner gap 12 to 22px before the arrow.
- **Hover / Focus:** background deepens to Signal Orange Press over 160ms; focus is the 2px orange outline.
- **Line:** surface or translucent white fill, Hairline Input border, ink text; hover darkens the border to Ink 3.
- **Small / dark:** 30px ink buttons with white text for inline row actions. Danger buttons use status red.

### Chips
- **Style:** link chips on the site are 4px, hairline-input border, ink-2 text. Filter tags are text plus count, not coloured pills.
- **Coming tag:** Plex Mono 10.5px uppercase in Signal Orange after a feature name, marking planned items.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** Surface on Paper.
- **Shadow Strategy:** none at rest (see Elevation).
- **Border:** 1px Hairline; Hairline Strong on hover.
- **Internal Padding:** 20 to 24px.

### Inputs / Fields
- **Style:** 40px (app) or 44px (site), Surface fill, 1px Hairline Input border, 4px radius, Placeholder colour for hints.
- **Focus:** border shifts to Signal Orange; caret is Signal Orange.
- **Error / Disabled:** error text in status red at 12.5px below the field; error banners on a pale red wash (#FBEFEC).

### Navigation
- **App top bar:** 64px, paper at 94% with blur, hairline bottom. Nav links 13.5px Ink 3, ink on hover; active link 550 weight with a 2px Mark Orange underline.
- **Site header:** 76px sticky, same treatment; collapses to a menu button below 860px with a full-width hairline sheet.
- **Tabs and segmented controls:** tabs underline the active item with 2px Signal Orange; segmented controls are a Segment Well with a lifted Surface option.

### Status Label
A 6 to 7px dot in the status colour followed by the label in Ink 2. No fill, no border, no pill.

### FIG. 01 Entry Figure (signature)
An isometric line drawing: the orange entry slab (three orange faces) resting on three pale olive ledger slabs, each with a 1px leader line to a Plex Mono annotation carrying its real figure. Leader lines draw once on load (1100ms, staggered 160ms). Below 640px annotations hide and a hairline legend list replaces them.

### Entry Editor (signature)
The one dark field: a Plex Mono code panel with stepper and toggle on Dark Field beside a Surface output with three figure cards and a split bar. Changing hours or billable recomputes payroll cost, invoice line and margin live, with the arithmetic shown in mono.

## Do's and Don'ts

### Do:
- **Do** keep orange to action and selection: #D4421F under white text, #EF582E for marks and drawing.
- **Do** show status as a dot plus text; ink for informational, red only above a limit.
- **Do** use Plex Mono for IDs, units, figures and captions, and Geist for everything a person reads as language.
- **Do** caption figures "FIG. 0n — description" in mono, uppercase or sentence case.
- **Do** separate sections with hairline rules and let the "+" crosshairs mark the frame on public pages.
- **Do** keep radii at 4px controls, 6px cards, 8px modals.
- **Do** keep text at 11px or larger and placeholders at 4.5:1 or better.
- **Do** tag planned features "Coming" so every claim matches the product.
- **Do** let leader lines draw once and numbers settle with an exponential ease-out; disable all of it under prefers-reduced-motion.

### Don't:
- **Don't** put an eyebrow or kicker above a heading.
- **Don't** set buttons, nav or headings in mono.
- **Don't** use status pills or coloured badge fills.
- **Don't** use red for anything that is not over a limit, or blue or violet for informational status.
- **Don't** add a second dark section or a dark glowing hero.
- **Don't** carry the Nordic Futurism plum, violet or glow vocabulary forward.
- **Don't** loop motion.
- **Don't** build hubs as icon-tile grids.
