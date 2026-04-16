# Stage Spec: CX & Product Journey

## User Journey Audit Results

### Flow 1: New User Signup → Onboarding → First Session
- **Signup:** Works. Clean form. Invite code required (GURU2026). No validation feedback until submit.
- **Onboarding Step 1 (Industry):** Works but only 3 industries. No progress bar (all other steps have one). Cards oversized.
- **Onboarding Step 2 (Specializations):** Works. Shows 7 specs for Consumer. Counter badge. Buttons overlap last card.
- **Onboarding Step 3 (Interests):** Works. Optional step with Skip. Helpful hint text.
- **Onboarding Step 4 (Capacity):** Works. 3 tiers with explanations. Buttons overlap explanation text.
- **Onboarding Step 5 (Goals):** Works. Slider + pill presets. Daily/weekly label confusion for Dive-in.
- **First Home Screen:** Loads. Rings empty (expected). Debug buttons visible (unexpected). Filter pills correct.
- **First Catch-up:** "No stories available" — always empty due to broken article tagging.
- **First Dive-in:** "No articles in this context" — always empty.
- **First Recap:** Ghost rings with "Begin Journey" disabled — correct gating behavior.
- **VERDICT:** User completes signup and onboarding successfully but hits a dead end — no content in any feed.

### Flow 2: Returning User → Catch-up → Save → Dive-in → Read
- **Cannot test** — no tagged content in DB. Catch-up always returns empty storyboards.

### Flow 3: Weekly Recap Journey
- **Cannot fully test** — requires reading activity first. Entry screen is well-designed.

### Flow 4: Deep Dive with Chrome Extension
- **Completely non-functional** — extension not distributed, ID not configured.

## Vision vs Reality Gaps

| Vision (BRD) | Reality | Gap |
|-------------|---------|-----|
| 10 industries, 50 specializations | 3 industries, 21 specializations | 70% missing |
| Filter-driven clustering shows relevant storyboards | All feeds empty (no tags) | Core feature broken |
| WebView + overlay reader with annotations | Extension not distributed | Primary reading experience missing |
| NotebookLM-style audio recap | UI scaffolded, generation not implemented | Feature advertised but not delivered |
| Weekly stats, streaks, commitments on Home | Only rings + progress bars | Dashboard incomplete |
| 3 concentric Apple Health rings | Interlocking Venn diagram | Design mismatch |

## Where the Journey Shines
1. Onboarding flow is polished and sequential (steps 2-5)
2. Recap entry with ghost rings creates genuine motivation
3. Goal-setting with capacity-driven defaults is thoughtful
4. Dark glass aesthetic feels premium

## Where It Falls Short
1. No content to consume — the core value prop is unreachable
2. Deep dive reading experience doesn't exist in production
3. Home dashboard is sparse — doesn't tell a story about your week
4. Empty states offer no guidance or hope
