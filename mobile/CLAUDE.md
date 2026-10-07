# Guru app - design rules

Read this before any change under `mobile/`. The root `CLAUDE.md` still applies.

**Design first:** no UI code without a Figma frame I've approved. If there's no frame for the change, draft one in this design language, show it to me, and wait. Then build to it and iterate until a screenshot of the running app matches it. The `guru-feature` skill runs this, and a hook asks before any UI edit until the design is recorded (root `CLAUDE.md`, the pipeline).

## Sources
- Code tokens are the truth: `constants/liquidGlass.ts`, `constants/darkTheme.ts`, `constants/lightTheme.ts`. Shared components: `components/ui/`.
- Figma `CVsVL7zvjyO3yoLlUJqBxI`: "Agentic Blocks EDL v2" (node `9:2`, the block rules) and "Identity FINAL" (node `10:2`). The glass tiers are node `77:3` in `7sgEGG13BI0Vksrg4hzpoQ`. Read a frame through the Figma connector before you build from it.
- The Figma files have no variables or components, so the connector returns raw hex. Use the code tokens, never the Figma hex.
- Stale frames, where the code wins: the type page (Inter; the code uses Manrope), the dark glass alphas (the code uses navy), H1 and the RecapStageCard (weekly copy; the product is daily-first), H4 (says every write is gated; two are).

## Rules
- One hero card per turn at most. Standard cards only for the item being worked. Minis for anything plural. At least two block shapes per turn. Text blocks two sentences max. Every turn ends with 2-4 pills under 60 characters.
- Color is a vocabulary: catch-up blue `#38BDF8`, dive-in pink `#EC4899`, recap orange `#FB923C` mean their mode in the agent and ring UI. `constants/industryConfig.ts` reuses the blue and the pink for other things, so don't copy colors from there.
- Use the tokens and `components/ui`. No new hex literals. `components/Agent/BlockRenderer.tsx` still hardcodes its colors: move a case to tokens in its own commit, when you are already changing that case.
- Glass tier by job (`GlassMaterialsV2`): ultraThin for chips, thin for pills, regular for cards, thick for modals and the reader, chrome for the tab bar. Legibility beats translucency.
- The organism (`GuruBlob`) is the agent at every agentic touchpoint. Working status shows only in the thinking row. Every new animation needs a reduced-motion still frame (`GuruBlob` shows the pattern); most older ones don't have one yet.
- Nothing internal reaches the screen: no raw `\n`, JSON, UUIDs or field names. Two server paths still break this (see `docs/known-gaps.md`). No em dashes in new UI copy; some older strings still have them.
- Admin screens render only when `/me/access` says admin (`hooks/useAdminAccess.ts`, which fails closed). The server still checks every admin call.

## Check your work
- `npx tsc --noEmit` from `mobile/` fails today on syntax errors in one old e2e test, which hide every type error behind them (see `docs/known-gaps.md`). Until that's fixed, it can't verify a change.
- For a visible change, run the web app and compare a screenshot with the Figma frame. The dev app talks to the production API, so sign in with a synthetic account only.
