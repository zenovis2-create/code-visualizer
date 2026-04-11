---
name: code-visualizer
description: Generate a localhost HTML visualization for recent code changes, a project subsystem, a whole repository, or an app flow. Use when the user asks to visualize code, explain a project structure visually, compare before vs after, or explain how a program works through diagrams and easy summaries.
---

# Code Visualizer

Use this skill when the user wants a clickable visual explanation instead of a plain terminal answer.

## Modes

- `diff`: recent or selected file changes, framed as before vs after
- `component`: one subsystem or area the user asked about
- `project`: layered whole-repo map
- `app`: entrypoint-to-runtime story

## Workflow

1. Choose the mode from the user request.
2. Resolve the absolute repo path.
3. Run the wrapper script.
4. Return the localhost URL plus a short summary.
5. Do not dump the full HTML into chat.

## Wrapper script

Use:

```bash
./skills/code-visualizer/scripts/run-code-visualizer.sh --mode <diff|component|project|app> --repo <absolute-path> [--query "..."] [--files "a.ts,b.ts"]
```

## Trigger examples

- `방금 수정한 코드 시각화해줘`
- `이 부분 구조를 그림으로 보여줘`
- `프로젝트 전체를 시각화해줘`
- `이 프로그램이 어떻게 동작하는지 시각화해줘`

## Output rules

- Always return the localhost URL.
- Always include one short `쉬운 설명` summary in chat.
- If confidence is low, say why briefly.
- Prefer the `paperclip` adapter when that repo is being analyzed.
