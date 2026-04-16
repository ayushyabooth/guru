# Guru MVP — Execution Plan
**Date:** 2026-04-10  
**Strategy:** Phased rollout, P0 blockers first, then grouped system-level fixes

---

## Execution Waves

### Wave 1: UNBLOCK PRODUCTION (Days 1-2)
**Goal:** Make the app functional for at least one user flow end-to-end.

| Task | Work | Parallelizable |
|------|------|----------------|
| P0-1: Revive Railway backend | Debug Railway deploy, verify env vars, restart service | Independent |
| P0-4: Hide dev tools | Add `__DEV__` or `APP_ENV` guard around Perf/Debug buttons | Independent |
| P0-2: Fix article tagging | Debug ingestion pipeline — ensure markdown parser tags articles with industries/specializations from section structure | Depends on P0-1 for prod |
| P0-3: Run ingestion | Upload expert links, trigger Tier 1 ingestion, verify articles appear in feed | Depends on P0-1, P0-2 |

**Parallel streams:**
- Stream A (Architect): P0-1 → P0-3 (backend infra → ingestion)
- Stream B (Developer): P0-4 + P0-2 (frontend fix + tagging fix)

**Exit criteria:** Catch-up feed shows storyboards for at least one filter context.

---

### Wave 2: CORE EXPERIENCE FIXES (Days 3-5)
**Goal:** Fix the most impactful UX and feature gaps so the core journey works.

| Task | Work | Parallelizable |
|------|------|----------------|
| P1-1: Add 7 missing industries | Expand `industries-specializations.json` to 10 industries, 50 specializations | Independent |
| P1-2: Fix React hydration | Debug SSR/CSR mismatch in Expo static export | Independent |
| P1-6: Fix stale form data | Clear form state on mount, disable autocomplete | Independent |
| P1-7: Add Step 1 progress bar | Add progress indicator to industry selection screen | Independent |
| P1-8: Fix daily/weekly labels | Change Dive-in label to "Weekly" throughout | Independent |
| P2-2: Fix button overlap | Add bottom padding/safe area on scrollable onboarding screens | Independent |
| P2-10: Fix package versions | `npx expo install --fix` | Independent |

**Parallel streams:**
- Stream A (Developer): P1-1 + P1-7 + P1-8 + P2-2 (config + onboarding fixes)
- Stream B (Developer): P1-2 + P1-6 + P2-10 (build + forms + deps)

**Exit criteria:** Full onboarding flow works with 10 industries. No console errors.

---

### Wave 3: POLISH & FEATURES (Days 6-10)
**Goal:** Complete major missing features and establish design consistency.

| Task | Work | Parallelizable |
|------|------|----------------|
| P1-3: Redesign rings | Implement concentric ring design (or validate current Venn with user testing) | Depends on EDL |
| P1-4: Home weekly stats | Add stats cards, streak, commitment reminder to Home screen | Independent |
| P2-4: Create EDL | Define color palette, typography, spacing, component patterns | Independent (UX) |
| P2-5: Improve empty states | Add illustrations, CTAs to all empty states | Depends on EDL |
| P2-8: Error recovery UI | Add retry buttons, network indicator, contextual errors | Independent |
| P3-1: Fix shadow deprecations | Replace shadow* props with boxShadow | Independent |
| P3-3: Move logout to settings | Create settings menu, move logout there | Independent |

**Parallel streams:**
- Stream A (UX): P2-4 EDL → P1-3 rings → P2-5 empty states
- Stream B (Developer): P1-4 + P2-8 + P3-1 + P3-3

---

### Wave 4: EXTENSION & AUDIO (Days 11-15)
**Goal:** Enable the full Deep Dive and Recap experiences.

| Task | Work | Parallelizable |
|------|------|----------------|
| P0-5: Extension distribution | Publish to Chrome Web Store, configure IDs, update manifests | Sequential |
| P1-5: Audio recap | Wire ElevenLabs TTS, implement audio generation, build player UI | Independent |
| P2-1: Resize industry cards | Redesign for 10 industries | Independent |
| P3-2: Migrate expo-av | Replace with expo-audio | Depends on P1-5 |

---

## Tracking Recommendation

### Primary: Linear (when MCP available)
Linear is the best fit because:
- **Issue tracking** with priority levels, labels, cycles
- **Roadmap view** for wave-based execution
- **GitHub integration** for PR linking
- **Lean UI** designed for engineering teams

### Fallback: GitHub Issues + Projects
If Linear MCP is not available:
- Create issues from the task backlog above
- Use GitHub Projects board with columns: Backlog → In Progress → Review → Done
- Label with `P0-blocker`, `P1-critical`, `P2-major`, `P3-minor`
- Milestone per wave

### Immediate: File-based specs (this directory)
The `AUDIT/` directory serves as the source of truth until a project management tool is set up. All specs can be imported into Linear or GitHub Issues.

---

## Agent/Workstream Playbooks

### PM Playbook
- Owns: Prioritization, spec sign-off, acceptance criteria definition
- Reviews: All P1+ tasks before marking done
- Decides: Spec mismatches (P2-3 specialization count, P1-8 daily/weekly)

### Architect Playbook
- Owns: P0-1 (infra), P0-3 (ingestion), production deployment
- Reviews: Backend changes, DB schema changes
- Monitors: Railway health, Neon DB, API latency

### Developer Playbook
- Owns: All code changes
- Rule: Never mark done without validation against acceptance criteria
- Rule: Group related fixes in single PRs (e.g., all onboarding fixes together)
- Rule: Test locally AND in production before closing

### UX Playbook
- Owns: P2-4 (EDL), P1-3 (rings), P2-5 (empty states)
- Deliverable: EDL document before any visual redesign work
- Reviews: All UI changes before merge

### QA Playbook
- Owns: Validation of all completed tasks
- Process: Screenshot before/after for every visual fix
- Process: API call verification for every backend fix
- Process: Console error check after every frontend fix

### Program Manager Playbook
- Owns: Wave tracking, dependency management, blocker escalation
- Daily: Update task status in backlog
- Weekly: Wave completion review
- Escalates: Any P0 not resolved within 48 hours
