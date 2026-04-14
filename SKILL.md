---
name: code-visualizer
description: Explain what was built or changed in plain language for non-developers, then show a visual guide to the current project and its capabilities. Use when the user asks what changed, what the project does, what a feature means, or wants a non-technical visual explanation of code or project structure.
---

# Code Visualizer

Use this skill for **vibe coders and non-developers** who need help understanding:

- what just changed
- what the project currently does
- which parts of the code correspond to user-visible capabilities
- what technical words like `UI`, `server`, or `shared` mean in plain language

## Intents

- `change-explainer`: explain what changed and why it matters
- `project-explainer`: explain what the project does today
- `feature-explainer`: explain one feature or area in product language

## Workflow

1. Choose the intent from the user request.
2. Resolve the absolute repo path.
3. Summarize the user's request and any recent conversation into a short plain-language focus string.
4. Run the wrapper script with the repo path and focus.
5. Return the localhost URL plus a short `쉬운 설명` summary.
6. Never dump the generated HTML into chat.

## Wrapper Script

Use:

```bash
./scripts/run-code-visualizer.sh \
  --intent <change-explainer|project-explainer|feature-explainer> \
  --repo <absolute-path> \
  [--focus "..."] \
  [--result-url "http://localhost:3000"] \
  [--screenshot "/absolute/path/to/screen.png"] \
  [--artifact "/absolute/path/to/result.pdf"]
```

## What the Output Must Do

- explain meaning before implementation
- show `지금 한 일 한눈에`, `전에는 / 지금은`, `사용자 입장에서 달라진 점`, `이 프로젝트가 하는 일`, `기능 지도`, `용어 번역`
- use `--result-url`, `--screenshot`, `--artifact` when you have real result evidence
- translate technical words immediately when they appear
- make technical drill-down secondary, under `더 깊게 보기` style sections
- only mention future direction when there is explicit plan or todo evidence in the repo

## References

- Read `references/non-dev-language.md` to keep the tone non-technical.
- Read `references/feature-mapping.md` when adjusting capability grouping.
- Read `references/change-explainer.md` when explaining before-vs-now changes.
- Read `references/term-translation.md` when translating repository or coding terms.
