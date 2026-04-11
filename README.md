# Code Visualizer

`code-visualizer` is a standalone skill-backed CLI that turns code changes and project structure into a local HTML report you can open from a localhost URL.

## What v1 does

- explicit invocation only
- local URL only
- one CLI entry point with 4 modes
- every report includes `쉬운 설명` and `기술 구조`
- first-class adapter support for `paperclip`

## Install

```bash
pnpm install
```

## Run

```bash
pnpm visualize --mode diff --repo /absolute/path/to/repo
pnpm visualize --mode component --repo /absolute/path/to/repo --query ui
pnpm visualize --mode project --repo /absolute/path/to/repo
pnpm visualize --mode app --repo /absolute/path/to/repo
```

The command prints a localhost URL like `http://127.0.0.1:43110/reports/<id>/index.html`.

## Skill trigger examples

- `방금 수정한 코드 시각화해줘`
- `이 부분 구조를 그림으로 보여줘`
- `프로젝트 전체를 시각화해줘`
- `이 프로그램이 어떻게 동작하는지 시각화해줘`

## Repo layout

- `src/`: collectors, adapters, analysis, renderer, server, CLI
- `skills/code-visualizer/`: skill metadata and wrapper script
- `viewer/`: HTML and CSS templates
- `examples/`: example usage notes
- `tests/`: behavior and failure coverage

## Notes

- Reports are written to `reports/`
- The server stays on `127.0.0.1:43110`
- Generic repos are supported, but `paperclip` gets stronger grouping and entrypoint heuristics
