# Guru MVP — Production Design Critique
**Date:** 2026-04-11  
**Stage:** Refinement (app is substantially built, now auditing fit & finish)  
**Context:** Professional learning platform, dark glass aesthetic, web production at dist-guru8.vercel.app  
**Method:** Live browser walkthrough with screenshots of every major screen

---

## Overall Impression

The dark glass aesthetic is **distinctive and premium-feeling** when it works. The interlocking rings logo, Orbitron headers, and teal accents create a recognizable brand. But the app has **four systemic problems** that undercut the premium feel:

1. **Broken icons everywhere** — empty squares where every icon should be (font loading 503)
2. **Inconsistent theming** — the reader page is light white/purple while everything else is dark navy
3. **Empty space mismanagement** — screens either have too much content (Dive-in cards) or too little (Recap Stage 1 blank canvas, Home below rings)
4. **No visual fallbacks** — missing hero images show blank/gray instead of gradient+emoji

Fix these four and the app goes from "interesting prototype" to "polished product."

---

## Screen-by-Screen Critique

### 1. LOGIN SCREEN

**First Impression:** Clean, centered, minimal. Guru logo + name immediately clear. Dark glass card feels premium.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| No loading indicator when "Sign In" is clicked — user doesn't know if anything happened | 🟡 Moderate | Add spinner or button state change on click |
| "Create Account" text link is low-contrast gray on dark — easy to miss | 🟢 Minor | Increase contrast or make it a subtle button |
| No password visibility toggle | 🟢 Minor | Add eye icon to toggle password visibility |

**What Works Well:**
- Logo + "GURU" wordmark is distinctive and immediately identifiable
- Glass card with border glow feels cohesive
- Minimal, focused — no distractions

---

### 2. HOME SCREEN (Above Fold)

**First Impression:** The rings draw the eye immediately — but their meaning isn't clear at first glance. "Your Progress" is generic. The "Logout" button in red is the second most prominent element, which is wrong.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Rings visualization unclear** — 3 overlapping Venn circles don't intuitively communicate 3 separate progress metrics. User has to read the legend below to understand. | 🔴 Critical | Consider concentric rings (Apple Health) or 3 separate arc gauges with labels inside |
| **"Logout" button is the 2nd most prominent element** — red on dark, top-right, draws eye before the rings | 🟡 Moderate | Move to settings/profile menu. Replace with settings gear icon. |
| **"Welcome back / Your Progress" header** is generic — doesn't tell user anything they don't know | 🟢 Minor | Use user's name: "Welcome back, Ayush" or show today's date/streak |
| **Content Filters section feels disconnected** — flat card below rings with no visual relationship | 🟡 Moderate | Integrate filter pills into the rings area or tab bar, not as a separate section |
| **Broken icon squares** in tab bar and filter pills | 🔴 Critical | Fix icon font loading (GUR-35) |

**Visual Hierarchy:**
- Eye goes to: Rings (correct) → Logout button (wrong) → GURU logo → Content Filters → Tab bar
- Should be: Rings → Filter pills → Weekly progress → Tab actions

**What Works Well:**
- The ring concept is right — progress visualization is motivating
- Orbitron "GURU" header is premium
- Dark background with organic blobs creates depth

---

### 3. HOME SCREEN (Below Fold — "Your Week")

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Progress bars are plain** — thin colored lines with no visual polish | 🟡 Moderate | Use glass-styled progress bars with gradient fills matching ring colors |
| **"0m / 140m" labels feel clinical** — raw numbers, not motivating | 🟡 Moderate | Show percentage or friendly text: "Just getting started" vs "Almost there!" |
| **"Last updated: 10:14:37 PM"** shows seconds — unnecessary precision | 🟢 Minor | Drop seconds: "10:14 PM" |
| **No weekly stats, streak, or commitment card** per BRD | 🔴 Critical | Implement missing dashboard components (GUR-13) |
| **Large empty space** below progress bars before tab bar | 🟢 Minor | Fill with streak counter, commitment card, or quick action buttons |

---

### 4. CATCH-UP FEED — In Focus Storyboard Card

**First Impression:** This is the best-designed screen in the app. The In Focus card structure matches the BRD vision — hero image, category badge, collapsible sections, spotlight quotes carousel, action buttons, related articles carousel. It feels like a polished news reader.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Hero image blank when no og:image** — dark rectangle, no fallback | 🟡 Moderate | Implement gradient + emoji fallback per BRD (GUR-42) |
| **Broken icon squares** on all buttons and section headers | 🔴 Critical | Fix icon fonts (GUR-35) |
| **Spotlight quote cards clip text** — "Beer and brats have al..." truncates mid-word | 🟢 Minor | Ensure clean truncation with ellipsis at word boundary |
| **"Also in this story" carousel cards** — first two have blank thumbnails with broken icons | 🟡 Moderate | Same hero fallback issue (GUR-42) |
| **Category badge** "Consumer · Food & Beverage" — clear and well-positioned | ✅ Good | — |

**What Works Well:**
- Collapsible sections with expand/collapse arrows — clean information hierarchy
- Spotlight quotes in horizontal scroll cards — engaging, interactive
- "Tap to find in article" CTA on each quote — good intent
- Action button trio (Dive In / Save / Not Relevant) — clear, well-spaced
- "Also in this story 5 articles" with carousel — perfect BRD alignment
- "Tap to bring into focus" instruction text — helpful affordance
- Overall liquid glass card treatment with teal tint — premium feel

---

### 5. DIVE-IN FEED — Two-Column Grid

**First Impression:** Content-rich, lots of articles visible. But the cards are very tall and text-heavy — user sees 2 full cards above fold, not the 4-6 a typical grid would show. The summary text takes too much vertical space.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Cards are too tall** — "What's in the article" summary shows 4-5 lines, pushing content below fold | 🟡 Moderate | Truncate summary to 2 lines with "..." or collapse by default |
| **"MORE TO EXPLORE" is the only section** — BRD E.1 says 3 sections: SAVED / EXPERT PICKS / MORE TO EXPLORE | 🟡 Moderate | Add saved and essential article sections when available |
| **Inconsistent card heights** — some have tall images, some have blank placeholders, making the grid uneven | 🟢 Minor | Fixed-height hero image area (consistent across all cards) |
| **"Dive In" button is teal, "Not Relevant" is gray** — clear hierarchy but could use icon differentiation | 🟢 Minor | Add swim/book icon to "Dive In", X icon to "Not Relevant" (blocked by GUR-35) |
| **No save/bookmark button on cards** — user can only "Dive In" or dismiss. Can't save for later from this view. | 🟡 Moderate | Add Save button between Dive In and Not Relevant |

**What Works Well:**
- Two-column grid layout matches BRD
- Hero images with gradient text overlay — polished when present
- Source + reading time + age — good metadata density
- Category badge positioning — consistent with Catch-up

---

### 6. ARTICLE READER — Web Fallback (Reading State Page)

**First Impression:** Jarring. The entire app is dark navy glass, then suddenly the reader is white/light with purple buttons. It feels like a completely different product. The content quality (summaries, quotes, prompts) is excellent but the visual treatment is wrong.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Light theme is a visual break** — white background, purple CTAs clashes with dark app | 🔴 Critical | Apply dark theme to reader or create a smooth transition (GUR-41) |
| **"The article has opened in a new tab" banner** takes prime viewport space | 🟡 Moderate | Make this a dismissible toast, not a persistent banner |
| **No hero image** on reader page — just broken icon squares | 🟡 Moderate | Show article hero image at top of reader |
| **Tabs (Summary/Insights/Notes/Ask Guru)** work but have no visual treatment — plain text underlined | 🟡 Moderate | Glass-styled tab bar matching the app's design language |
| **Notes tab is a dead end** — "Install Chrome extension" with no alternative | 🔴 Critical | Web fallback must provide in-page note-taking (GUR-9) |
| **Ask Guru tab is read-only** — shows prompts but user can't interact | 🔴 Critical | Web fallback must provide Q&A input field (GUR-9) |
| **Spotlight Quotes** render well with left-border styling | ✅ Good | — |
| **"Done Reading" button** is large purple CTA — works but feels off-brand (purple vs teal) | 🟢 Minor | Match to Guru teal or gold accent |

**What Works Well:**
- Content quality is excellent — "What's in it", "Why it matters", "Between the lines" are genuinely insightful
- Spotlight Quotes are well-formatted with clear left-border visual
- Timer counting up (0:09 → 0:28 → 0:47) — working correctly
- Socratic prompts in Ask Guru tab are high-quality, personalized to F&B

---

### 7. RECAP — Entry Screen

**First Impression:** The best-designed screen in the app. Ghost rings with gold accents create genuine motivation to "fill the final ring." Activity pills are informative without being clinical. "Continue Journey" gold button is compelling.

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **"Journal" button top-right** has no visual weight — easy to miss | 🟢 Minor | Consider a more prominent archive/journal link or move to a menu |
| **No tier badge** — BRD F.1 says show "Full Experience / Standard / Lite" badge | 🟡 Moderate | Add tier badge near week date (GUR-38) |

**What Works Well:**
- Ghost ring visualization creates visual tension — motivates completion
- Gold/amber color language for Recap is distinct from teal (Catch-up) and pink (Dive-in)
- Activity pills ("4m reading · 2 filters · 4m deep dives") — compact, informative
- "Continue where you left off" copy — acknowledges return users
- Journey Stages card with numbered progression — clear roadmap

---

### 8. RECAP — Stage 1 (Snapshot)

**First Impression:** Empty. A blank dark screen with one line of text ("Your peak day was N/A") and a button. This should be the most visually rich screen in the entire app — the "Glass Memory Wall."

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Completely empty canvas** — nothing renders despite user having reading activity | 🔴 Critical | Fix snapshot data pipeline; render article cards, quotes, clusters (GUR-39) |
| **"Your peak day was N/A"** — raw null value shown to user | 🔴 Critical | Compute peak day or hide when no data |
| **25% ring indicator (top-right)** — correct per spec | ✅ Good | — |
| **Massive empty space** — feels broken, not intentional | 🔴 Critical | This screen should be immersive and engaging per BRD |

---

### 9. RECAP — Stage 2 (Questions)

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Only 1 question** — BRD says 2-5 depending on tier | 🔴 Critical | Fix question generation service (GUR-40) |
| **Question is generic commitment prompt** — not article-specific | 🔴 Critical | Questions should reference actual articles read (GUR-40) |
| **Massive empty space** between question and input | 🟡 Moderate | Center the question vertically or add article context card |
| **"REFLECTION" badge** — correct labeling per BRD | ✅ Good | — |
| **50% ring indicator** — correct | ✅ Good | — |
| **Submit button broken icon** — empty square instead of send arrow | 🟡 Moderate | Fix icon fonts (GUR-35) |

---

### 10. TAB BAR (Persistent)

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| **Broken icon squares** for Home and all tabs | 🔴 Critical | Fix icon fonts (GUR-35) |
| **Ring indicators next to tab labels** are too small to convey progress at a glance | 🟡 Moderate | Increase ring size or use progress bar style (GUR-24) |
| **Tab labels are low-contrast** — "Home", "Catch-up", "Dive-in", "Recap" are faint gray | 🟢 Minor | Increase contrast for inactive tabs |
| **Active tab indicator** is subtle — slightly brighter text, no underline or background highlight | 🟡 Moderate | Add clear active state (underline, background, or bold) |

---

## Cross-Cutting Design Issues

### 1. Broken Icons (Systemic)
Every screen has empty squares where icons should be. This is the single highest-impact visual issue. It affects buttons, badges, section headers, tab bar, category labels, and action CTAs. **Fix this one thing and the entire app looks 50% more polished.**

### 2. Theme Inconsistency
The app is dark navy glass everywhere EXCEPT the article reader (white/light purple). This must be resolved — either make the reader dark, or create a deliberate, smooth transition between themes.

### 3. Empty State Design
When things are empty (no hero image, no snapshot data, no articles), the app shows blank/gray/N/A instead of designed fallback states. Every empty state needs intentional treatment.

### 4. Typography
- Orbitron for logo/headers — distinctive but overused if applied to body text
- Body text appears to use system font — readable but lacks character
- No clear type scale — heading sizes vary between screens
- Line height is generally good for readability

### 5. Color Discipline
- **Teal (#10B981)** — Catch-up, primary actions, Consumer category → well-established
- **Pink/Magenta** — Dive-in ring → used only on ring, not carried through to Dive-in UI
- **Gold/Amber** — Recap → well-carried through to buttons, badges, ring
- **Purple (#6366F1)** — Reader page → inconsistent with dark theme, feels imported from different design system
- Category colors (Consumer green, Tech purple, Finance teal) defined but **only Consumer is visible** since there are only 3 industries with content from one

---

## Priority Recommendations

### 1. Fix Icon Fonts (P0 — GUR-35)
This is the single highest-impact fix. Copy icon font files from node_modules to assets/fonts in the Vercel export. Every screen improves immediately.

### 2. Fix Hero Image Fallback (P1 — GUR-42)
Implement gradient + emoji fallback per BRD. Affects Catch-up cards, Dive-in cards, and carousel thumbnails. Use category colors for the gradient.

### 3. Dark Theme on Reader Page (P1 — GUR-41)
The light reader page breaks the premium feel of the entire product. Apply the dark glass aesthetic or create a smooth dimming transition.

### 4. Fix Recap Stages 1-2 (P1 — GUR-39, GUR-40)
Stage 1 is empty, Stage 2 has wrong questions. These are the climax of the weekly experience and they're broken. Fix the snapshot data pipeline and question generation.

### 5. Web Fallback for Notes + Ask Guru (P0 — GUR-9)
The reader's Notes and Ask Guru tabs are dead ends without the extension. Provide in-page note-taking and Q&A input for web users.

### 6. Establish EDL (P2 — GUR-21)
Document the design language: color tokens, typography scale, spacing grid, glass card variants, button styles, icon system. This prevents future inconsistencies and speeds up all design work.
