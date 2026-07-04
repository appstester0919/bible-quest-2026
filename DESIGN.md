---
version: alpha
name: Bible Quest
description: Duolingo-inspired Bible reading app for young Christians. Vibrant gamification meets sacred text.
colors:
  primary: "#1F2937"
  streak: "#FF9600"
  success: "#58CC02"
  gem: "#1CB0F6"
  xp: "#FFC800"
  danger: "#FF4B4B"
  surface: "#FFFFFF"
  background: "#F7F7F7"
  muted: "#9CA3AF"
  accent: "#CE82FF"
typography:
  h1:
    fontFamily: "Nunito"
    fontSize: 2rem
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Nunito"
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.3
  body-md:
    fontFamily: "Noto Sans TC"
    fontSize: 1rem
    lineHeight: 1.7
  scripture:
    fontFamily: "Noto Serif TC"
    fontSize: 1.125rem
    lineHeight: 1.8
  label:
    fontFamily: "Nunito"
    fontSize: 0.875rem
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  sm: 8px
  md: 12px
  lg: 20px
  xl: 28px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
elevation:
  card: "0 2px 8px rgba(0, 0, 0, 0.06)"
  floating: "0 8px 24px rgba(0, 0, 0, 0.12)"
  button: "0 2px 0 rgba(0, 0, 0, 0.15)"
components:
  button-primary:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
  button-primary-hover:
    backgroundColor: "#46A302"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
  streak-card:
    backgroundColor: "{colors.streak}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  xp-reward:
    backgroundColor: "{colors.xp}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm} {spacing.md}"
  lesson-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    height: "auto"
    width: "100%"
  badge-locked:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
  badge-unlocked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
  partner-avatar:
    backgroundColor: "{colors.gem}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    size: "48px"
  progress-bar-track:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.full}"
    height: "12px"
  progress-bar-fill:
    backgroundColor: "{colors.success}"
    rounded: "{rounded.full}"
    height: "12px"
  bottom-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "0px"
    height: "72px"
  bottom-nav-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.success}"
    rounded: "0px"
    height: "72px"
---

## Overview

**Bible Quest** is a Duolingo-inspired Bible reading companion for young Chinese-speaking Christians (16–25). The visual identity takes Duolingo's playful, gamified aesthetic — chunky rounded corners, vibrant accent colors, bold sans-serif type — but tempers it with reverence for the text itself: scripture uses a serif face at generous line height, never color-clashed with chrome.

Two zones of the UI follow different rules:
- **Chrome / UI** (nav, buttons, stats, achievements): sans-serif, saturated colors, rounded shapes
- **Scripture / Reading** (chapter text): serif, generous line-height, monochrome ink on warm white

Gamification color is reserved for state, not decoration. Orange = streak (rare, urgent, celebratory). Green = success (completed, correct). Gold = XP reward. Purple = rare achievement. Red = warning (streak at risk).

## Colors

### Semantic palette (use these, not raw hex)

| Token | Hex | When to use |
|---|---|---|
| `colors.streak` | `#FF9600` | Streak fire, daily reminders, "keep it going" urgency |
| `colors.success` | `#58CC02` | Completed lesson, correct answer, primary CTA |
| `colors.gem` | `#1CB0F6` | XP tokens, level-up, info banners |
| `colors.xp` | `#FFC800` | XP reward popups, achievement unlocks |
| `colors.danger` | `#FF4B4B` | Streak at risk, destructive confirm |
| `colors.accent` | `#CE82FF` | Rare achievements, special milestones |
| `colors.muted` | `#9CA3AF` | Inactive states, secondary text |

### Neutrals

| Token | Hex | When |
|---|---|---|
| `colors.surface` | `#FFFFFF` | Cards, modals, nav background |
| `colors.background` | `#F7F7F7` | App background behind cards |
| `colors.primary` | `#1F2937` | Body text, headings on light bg |

## Typography

Two font families, used in distinct zones:

- **Nunito** (sans) — UI chrome, headings, buttons, labels. Rounded geometric, friendly, high x-height. Weights: 700, 800.
- **Noto Serif TC** (serif) — Scripture text only. Forgiving line-height (1.8) preserves reading flow. Traditional feel balances the playful chrome.

**Font fallback chain** is critical for Chinese support: `Noto Sans TC` and `Noto Serif TC` after the Latin faces.

## Layout & Spacing

4-px base unit. Use spacing tokens, never raw values.

Mobile-first. Bottom nav at 72px height (above iOS safe area). Cards use `rounded.lg` (20px) for friendly chunkiness.

## Shapes

Rounded corners are **load-bearing**. Every card, button, badge uses one of `rounded.sm` (8), `rounded.md` (12), `rounded.lg` (20), `rounded.xl` (28). Pill-shaped (`rounded.full`) for badges and XP tokens.

Sharp corners reserved for: bottom nav, full-bleed modals.

## Components

### Buttons
Two flavors only. **Primary** = green CTA (Start Lesson, Continue, Confirm). **Secondary** = white outline (Skip, Maybe Later). No tertiary. No icon-only buttons in MVP.

### Streak card
Full-width orange hero. White text. Shows 🔥 + current streak count + "today" status. Animates on increment (confetti + scale-up).

### XP reward
Pill-shaped gold badge that floats above the lesson-complete button. Tap → confetti burst + audio chime.

### Lesson card
White card, 20px corners, 24px padding. Shows: book name (h2), chapter ref, estimated reading time, "Start" button.

### Badges
Circular. Locked = muted gray. Unlocked = accent purple. Icon size 32px inside 64px circle.

### Progress bar
Thick (12px), rounded ends, green fill on light gray track. Used for: today's plan completion, plan progress.

## Do's and Don'ts

### ✅ Do
- Use `colors.success` for primary CTA — users learn green = go
- Use `colors.streak` only for streak-related moments (don't dilute its meaning)
- Use serif font for scripture, sans for everything else
- Animate streak counter increment (it's the emotional peak of the app)
- Show confetti on lesson complete (every time — builds the habit loop)

### ❌ Don't
- Don't introduce new colors outside this palette (no random purples, no gradients except brand hero)
- Don't use serif for UI text (buttons, labels, nav)
- Don't use sharp corners on cards
- Don't use red as a decorative color (only warning state)
- Don't over-gamify — no gems, no leagues, no leaderboards in MVP (the spec explicitly excludes these)
- Don't use emoji in chrome (only inside user content like reflections)