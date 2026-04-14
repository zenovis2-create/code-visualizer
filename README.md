# Code Visualizer

`code-visualizer` is a pure Codex skill for non-developers and vibe coders.

It explains:

- what changed
- what the project currently does
- which parts of the code correspond to user-visible capabilities
- technical terms in plain language first
- evidence confidence based on request, diff, repo, and result inputs
- repeated term exposure so non-developers learn concepts over time

## Install

Option 1: install directly from GitHub with the skill installer.

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo zenovis2-create/code-visualizer \
  --path . \
  --name code-visualizer
```

Option 2: clone into your local skills directory.

```bash
git clone https://github.com/zenovis2-create/code-visualizer.git \
  ~/.codex/skills/code-visualizer
```

After install, restart Codex so the skill is picked up.

## Trigger Examples

- `방금 만든 거 쉽게 설명해줘`
- `지금 바뀐 걸 비개발자도 알게 설명해줘`
- `이 프로젝트가 하는 일을 쉽게 보여줘`
- `이 기능이 뭔지 쉽게 설명해줘`

## Local Run

```bash
./scripts/run-code-visualizer.sh \
  --intent project-explainer \
  --repo /absolute/path/to/repo \
  --focus "비개발자에게 무엇을 설명해야 하는지" \
  --result-url "http://localhost:3000" \
  --screenshot "/absolute/path/to/screen.png" \
  --artifact "/absolute/path/to/result.pdf"
```

Supported intents:

- `change-explainer`
- `project-explainer`
- `feature-explainer`

Result evidence inputs:

- `--result-url "http://localhost:3000"`
- `--screenshot "/absolute/path/to/screen.png"`
- `--artifact "/absolute/path/to/result.pdf"`

The script generates a localhost visual guide under:

- `~/.codex/state/code-visualizer/reports`

The report now includes:

- `변경 영수증`
- `근거 신뢰도` 배지
- `이번에 배운 용어` with seen/new concept memory
- `질문형 안내` cards that jump to the right section
- automatic `실제 화면/결과물 연결` matching to the closest capability and representative files

## Result Evidence Inputs

Use these when you want the report to connect code to a real result:

- `--result-url`: running page or deployed URL
- `--screenshot`: local screenshot/image path
- `--artifact`: local output file such as PDF, HTML, or image
