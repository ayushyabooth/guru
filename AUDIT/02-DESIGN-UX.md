# Stage Spec: Design & UX

## Design Language Assessment

### Current State: No Formal EDL
There is no unified Experience Design Language document. Design decisions are scattered across:
- `guru-ux-wireframes.md` (118KB — detailed but prescriptive, not systematized)
- `ux-assets/guru-liquid-glass-design-guide.md` (visual guide)
- Inline styles in React Native components
- Category color constants in `industries_config.py`

### What Exists (Implicit Design System)
- **Color palette:** Dark navy background (#0F172A-ish), teal accents (#10B981), category hues defined per industry
- **Glass cards:** `backdrop-filter: blur(20px)`, translucent borders, subtle shadows — applied inconsistently
- **Typography:** Orbitron for logo/brand, system font for body. No formal type scale.
- **Icons:** Mix of emoji (onboarding) and custom SVG (tab bar). No icon library.
- **Spacing:** Ad-hoc. No 4px/8px grid system evident.
- **Animation:** LayoutAnimation used in some places, not others.

### Design Consistency Issues
1. **Auth screens** — Dark glass card, centered, consistent
2. **Onboarding screens** — Mix of full-width cards (specializations) and grid cards (industry). Different patterns on each step.
3. **Home screen** — Venn rings don't match any standard pattern. "Content Filters" section feels disconnected.
4. **Feed screens** — Minimal styling. Empty states are plain text. No visual richness.
5. **Recap** — Best-designed screen. Ghost rings, journey stages, gold accents. Closest to the BRD vision.
6. **Tab bar** — Tiny ring icons, low contrast labels, functional but not polished

### Specific UX Issues
- Industry cards use icon circles but specialization cards use text-only
- "Continue" button style varies (full-width vs fixed-width, different border-radius)
- Progress bar appears on steps 2-5 but not step 1
- Button overlay on scrollable content (specializations, capacity screens)
- No hover states visible on desktop web
- No focus states for keyboard navigation
- Color coding for categories (Consumer=green, Tech=purple, Finance=teal) defined but not consistently applied in cards, pills, borders

### EDL Recommendation
Create a formal EDL document covering:
1. **Color tokens** — Background, surface, text, accent, category hues, status colors
2. **Typography scale** — H1-H4, body, caption, label with font-size/weight/line-height
3. **Spacing scale** — 4, 8, 12, 16, 24, 32, 48px
4. **Glass card variants** — Default, selected, disabled, category-tinted
5. **Button variants** — Primary, secondary, ghost, destructive
6. **Input variants** — Default, focused, error, disabled
7. **Empty states** — Illustration + message + CTA pattern
8. **Loading states** — Skeleton, spinner, progress bar
9. **Category color mapping** — Consistent across pills, cards, borders, backgrounds
10. **Animation tokens** — Duration, easing, enter/exit patterns
