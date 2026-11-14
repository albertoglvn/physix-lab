# Brief: the Codex workflow board

This brief defines the board in [`docs/assets/codex-workflow.png`](assets/codex-workflow.png),
which the README shows under "How Codex built Physix". Use it to check the board or to redraw
it after the method or the figures change.

The board introduces Physix and shows how to use rules, shared data formats, separate
assignments and checks to build a project with Codex. It shows where you record decisions,
verify results, ship the lab and make the demo. The audience is creators and founders
who want a method they can use on their own projects.

Read these files to check the facts.

| File | What you check in it |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | The task rules, file ownership, checks and handoff |
| [WORKLOG.md](WORKLOG.md) | Workstream handoffs, checks and known limitations |
| [CONTRACTS.md](CONTRACTS.md) | Shared data formats and units |
| [COPYWRITING.md](COPYWRITING.md) | The voice and claims |
| [DESIGN.md](DESIGN.md) | Colours, type and layout |
| [CHATGPT.md](CHATGPT.md) | The public lab and the private plugin that the Site provisions |
| [DEMO.md](DEMO.md) | The agent records the lab, measures values and edits the cut. The owner records the signed-in ChatGPT segment. |
| [PHYSICS.md](PHYSICS.md) and [MODEL.md](MODEL.md) | Reference solves and held-out model evaluation |

## The one idea

- **Title** “How Codex builds Physix in six steps”
- **Subtitle**, two short sentences on one line "Physix is a physics lab that you or ChatGPT
  can run. Six habits and a few plain text files keep your AI agent on track."

A founder who reads only the title, the six headings and the shelf heading should be able to
explain the method in one breath.

## Output

- One landscape board, 1920 × 1080 px, as SVG and PNG.
- Whiteboard look: an off-white board (`#f9fbf7`), marker strokes with a slight wobble and
  simple hand-drawn pictures. No texture over text.
- A marker font (Kalam Bold) for the title, the step headings and the shelf heading only.
  Inter for everything else.

## The six steps

Draw the six steps as a loop from left to right, with each number in a circle. Each step has
a heading in sentence case that starts with a verb, short copy on at most two lines,
one simple drawing, and at most one file tag.

| Step | Heading | Sentence | Drawing | File tag |
| --- | --- | --- | --- | --- |
| 1 | Write the rules once | "Your agent reads it before every task." | A sheet labelled `AGENTS.md` | None, the sheet names it |
| 2 | Agree on the data | "Agree on fields and units before you build." | Two puzzle pieces, one marked "m, kg" and one "s, N" | `CONTRACTS.md` |
| 3 | Give each agent a lane | "Assign separate files and branches." | Three lanes labelled "Physics", "Lab" and "ChatGPT plugin" | None |
| 4 | Let checks decide | "619 tests pass. Check the page in a browser." | A frame with two ticks, "Tests" and "Browser check" | None |
| 5 | Leave a note for the next agent | "Log what changed and what still needs work." | A notebook labelled `WORKLOG.md` | None, the notebook names it |
| 6 | Prove it before you claim it | "Check results against theory or a solver." | Two overlapping curves labelled "Simulation" and "Theory" | `PHYSICS.md · MODEL.md` |

- A red arrow runs from step 4 back to step 3, labelled "Fix failed checks".
- The return path along the bottom carries one label, "What you learn goes back into the
  rules.", and ends in an arrow into step 1.
- Two stops sit on the return path, each a box with a small drawing, a heading and one
  sentence. The path reaches Ship, then Demo.
  - **Ship**, with a globe: "ChatGPT Sites hosts the lab and the plugin."
  - **Demo**, with a play button: "Your agent films the lab and logs each value."

## The file shelf

Under the loop, place the heading "One file for each job" beside the sentence "Your agent
reads the file that owns the work and updates it in the same change." Then five cards, each
with a file name and what the file decides:

| File | Card text |
| --- | --- |
| `DESIGN.md` | Colours, type and where each panel sits |
| `COPYWRITING.md` | The voice and what the product may claim |
| `LAB_PLAN.md` | Which phase is done and which comes next |
| `CHATGPT.md` | How the plugin is set up and what it returns |
| `DEMO.md` | The demo script and the proof behind it |

## Number

Step 4 gives the total from the three test suites. The footer shows the date and the
breakdown as “Ran on 14 Nov 2026 · 465 web · 23 Worker · 131 Python”.

Before you publish, re-run these commands from the repository root and update the figures and
the date if they changed:

- `pnpm --filter @physix/web exec vitest run`
- `node --test mcp/sites/worker.test.mjs`
- `uv run --no-sync pytest -q`

## Size and colour

- Step headings are at least 38 px, sentences and card text at least 23 px, and nothing is
  smaller than 20 px. Each heading fits on two lines.
- No text touches or crosses a box edge.
- Use ink (`#263229`) for body text and outlines and muted ink (`#4f5f53`) for the footer.
- Use green (`#32664e`) for files, the theory line and the icons on the return path.
- Use amber (`#b07a1a`) for the checks in step 4.
- Use red (`#a13e36`) for the "Fix failed checks" arrow and label.

## Copy rules

Follow [COPYWRITING.md](COPYWRITING.md).

- Speak to the reader as "you". Say **AI agent** once, in the subtitle, and **your agent**
  everywhere else. Say **Codex** only in the title.
- Use everyday words. Keep a technical word only when it names something the reader can copy,
  such as `AGENTS.md`.
- No adjectives a reader can't check, such as "robust", "seamless", "powerful" or "smart",
  and no exclamation marks.

## Leave out

- A colour legend.
- Schema names, test fixtures, `make` commands, pre-commit hooks, CI, lockfiles, solver names,
  timing details and folder paths.
- The words "merge", "gate", "contracts", "workstream" and "fixtures" outside file names.
- Personal names, email addresses, account IDs, anything in `.openai/`, secrets and every URL.

## Check before you deliver

- [ ] The title, the six headings and the shelf heading explain the method on their own.
- [ ] Every label sits fully inside its box at 100% zoom.
- [ ] Labels and shapes identify the checks, files and return path without a separate key.
- [ ] Contrast against the board is at least 4.5:1 for all text.
- [ ] The test count matches a fresh run of the three commands.
