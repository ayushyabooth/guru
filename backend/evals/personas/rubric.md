# Persona QA rubric

LLM personas are pre-beta QA and regression checks, never user research. They are more articulate and patient than real people: good at finding friction and breakage, bad at judging value or delight. Real beta users tell us what matters; both feed the same Report a bug pipe into Linear.

Every persona in `personas.yaml` uses this rubric. Their `notices` say which areas they weigh most, not which ones they may skip. How a run works is in `.claude/skills/guru-persona/SKILL.md`.

## What counts as a finding

- Friction or breakage the persona hit while doing a task: it happened on a screen, it can be repeated, and it breaks a line below.
- Not an opinion about value or delight ("I'd use this daily", "this feels boring"). Personas can't judge that; real beta users do.
- One finding per root cause. The same broken thing on three screens is one finding that names three screens.
- Something already filed in this run by the same persona is not filed again.

## The areas

### visual: alignment, spacing, truncation, contrast, tap targets, dark mode
- Edges that don't line up, uneven gaps between siblings, padding that changes between cards of the same kind, radii or shadows that don't match their neighbors.
- Text cut off mid-word, an ellipsis hiding the part that matters, a label that wraps badly on a phone.
- Contrast under 4.5:1 for body text, or under 3:1 for large text and icons. Read the computed colors when unsure.
- Tap targets under 44x44pt on the phone viewport, or two targets so close a thumb hits both.
- Dark and light both, switched with the browser's color scheme: text that disappears, glass that turns muddy, an icon drawn for the other mode.
- Design drift: colors that aren't the app's tokens (`mobile/constants/`), the mode colors on the wrong thing (catch-up blue `#38BDF8`, dive-in pink `#EC4899`, recap orange `#FB923C`), em dashes in UI copy, or anything internal on screen (a raw `\n`, JSON, a UUID, a field name).

### clarity: labels, jargon, empty and error states, feedback after an action
- A label a new user can't decode, or one word used for two different things.
- An empty state that doesn't say why it's empty and what to do next.
- An error that doesn't say what happened and what to do, or shows raw exception text.
- No feedback after an action (save, hide, send, approve): the persona can't tell whether it worked.

### findability: can they find X in N taps
- Name the target and count the taps from where the persona was. More than 3 taps to a core thing (a saved story, a note or highlight, today's progress, the Report button) is a finding.
- Something reachable only through the agent with no screen path, or only on a screen when the agent claims it can help.

### flow: dead ends, back, lost state
- A screen with no way forward or back.
- The browser's back or the app's back landing somewhere unexpected.
- Lost state: a draft, a journey, a filter or a scroll position gone after a tab switch, the reader, or a reload.
- A tap that fires twice, or a send that duplicates.

### speed: perceived speed
- Under 1 second feels instant. From 1 second on, the screen must show that it's working. Over 3 seconds with no sign of progress is a finding.
- An agent turn shows its first block within about 4 seconds (the eval budget, PERF-01 and PERF-03) and finishes within 20 seconds.
- Time it from the tap to the first readable content, and write the number down.

### agent: relevance, grounding, tone, approval cards
- Relevance: cards and answers fit the persona's topics and the question asked.
- Grounding: answers come from the article or the user's own reading, and say which.
- Tone: plain and short, no filler, no lecture. A text block is two sentences at most, and every turn ends with 2-4 pills under 60 characters.
- "next" moves on and Skip means not this one. Neither saves or hides a story on its own.
- Approval cards: anything written in the user's name (a note, a commitment) shows its full text on an "APPROVAL NEEDED" card first, and Approve and "Keep as is" do what they say.

### trust: sources, overclaiming
- Every claim, number and quote can be found in the article; quotes match word for word.
- The source name, date and link are there and right.
- When the reading can't answer, the agent says so instead of inventing an answer.

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| blocker | The persona can't finish the task, or something is lost or wrong where they can't see it. | A crash or blank screen, a dead end, lost notes or saves, a write in the user's name with no approval, an invented quote shown as the source's, a report that can't be sent. |
| major | The task finishes only with a workaround, or the result misleads. | An action that doesn't stick or does more than asked, state lost on a reload, a wrong number, an off-topic feed, a turn over the 20-second budget, an error with no next step. |
| minor | Friction that slows the persona down without stopping them. | An unclear label, a tap or two too many, a 3-10 second wait that shows it's working, an empty state with no next step. |
| polish | Cosmetic. | A 1-2px misalignment, uneven spacing, a contrast dip on secondary text, a copy nit. |

Between two levels, pick the lower one and say why in the run log.

## Evidence

Every finding records:
- **Screen:** where it happened (Home, Catch-up, Dive-in, Recap and its stage, the Guru tab and the turn number, the reader).
- **Steps:** the shortest numbered path that repeats it.
- **Expected and seen:** one line each.
- **Proof:** the screenshot that shows it (named S1, S2 and so on in the run log), the exact on-screen text, and for the agent the turn number and what was asked.

## Filing

- **Where:** the Report entry point on the screen it happened on: the Report button (the flag at the top right) on Catch-up, Dive-in, Recap and the reader; the "Report" flag under an agent turn, which attaches that turn; the Beta card ("Report a bug") on Home.
- **Category:** the closest chip. "Wrong answer" for agent and trust, "Slow" for speed, "Looks broken" for visual and broken flow, "Something missing" for findability and missing feedback or states, "Other" for the rest.
- **What did you expect?:** expected versus seen, the severity and the steps, in under about 600 characters. The first 60 characters become the Linear title, cut mid-word, so the severity and a short title come first and fit in 60 characters together:

  `[major] Skip hid the story. Expected: Skip moves to the next story. Seen: ... Steps: 1) ... 2) ... Persona: Kai, run 2026-10-07-kai.`
