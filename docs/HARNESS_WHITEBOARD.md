# Brief: a whiteboard diagram of how Physix is built with Codex

You are a ChatGPT agent making one whiteboard diagram. It shows how this repository keeps
Codex on track: one rules file, separate lanes, automatic checks, a work log and proof for
every number.

The audience is creators and founders who use AI agents to build their own ideas, not
software engineers. They should leave with a method they can copy, not with a map of this
repository. Keep the facts true to the repository and the words plain.

Read these files to check the facts. Don't copy their detail onto the board.

| File | What you check in it |
| --- | --- |
| `AGENTS.md` | The rules every task starts from, the split by directory, the checks and the handoff |
| `docs/WORKLOG.md` | That each change is recorded with its checks and known failures |
| `docs/COPYWRITING.md` | The voice rules the board follows |
| `docs/DESIGN.md` | The colours |

## The one idea

- **Title**, at most 9 words: "How Codex builds Physix in six steps".
- **Subtitle**, one sentence of at most 16 words: "One rules file, separate lanes and automatic
  checks keep your AI agent on track."

A founder who reads only the title and the six headings should be able to explain the method
in one breath.

## Output

- One landscape board, 1920 × 1080 px, as SVG and PNG. No portrait version.
- Whiteboard look: an off-white board (`#f9fbf7`), marker strokes with a slight wobble and
  simple hand-drawn pictures. No texture over text.
- A marker font for the title and step headings only. Inter for everything else.

## The six steps

Draw the six steps as a loop from left to right, with each number in a circle. Each step has
exactly three things: a heading of 2 to 5 words in sentence case that starts with a verb, one
plain sentence of at most 10 words, and one simple drawing. Nothing else goes in a step.

| Step | Heading | Sentence | Drawing |
| --- | --- | --- | --- |
| 1 | Write the rules once | "Your agent reads one file before every task." | A single sheet labelled `AGENTS.md` |
| 2 | Agree the shapes first | "Decide what data looks like before anyone builds." | Two puzzle pieces that fit together |
| 3 | Give each agent a lane | "One folder each, so no two agents collide." | Three lanes labelled "Physics", "Lab" and "ChatGPT plugin", with no folder paths |
| 4 | Let checks decide | "Tests run, then someone looks at the real page." | One gate with two ticks, "Tests" and "Browser check" |
| 5 | Leave a note for the next agent | "A work log says what changed and what broke." | A notebook labelled `WORKLOG.md` |
| 6 | Prove it before you claim it | "Every number is checked against theory or a solver." | Two overlapping curves labelled "Simulation" and "Theory" |

- A red arrow runs from step 4 back to step 3, labelled "Fails go back".
- The return path along the bottom carries one label, "What you learn goes back into the
  rules.", and ends in an arrow into step 1.
- One "Ship" stop sits on the return path with one sentence: "The same code runs the lab and
  the ChatGPT plugin."

## Number

Show one number at most, in a small tag at the bottom left:

- "484 automated tests pass"
- In small text under it: "465 lab + 19 plugin · 13 Nov 2026"

Before you publish, re-run both commands from the repository root and update the figures and
the date if they changed:

- `pnpm --filter @physix/web exec vitest run`
- `node --test mcp/sites/worker.test.mjs`

## Word, space and colour budget

- At most 90 words on the board, not counting the title.
- At least a third of the board stays empty.
- Step headings are at least 40 px, sentences at least 26 px, and nothing is smaller than
  22 px. Each heading fits on two lines at most.
- No text touches or crosses a box edge.
- Four colours, each with one meaning, labelled in place so the board needs no legend:
  - ink `#263229` for all text;
  - green `#32664e` for the two files, `AGENTS.md` and `WORKLOG.md`;
  - amber `#b07a1a` for the checks in step 4;
  - red `#a13e36` only for "Fails go back".

## Copy rules

Follow `docs/COPYWRITING.md`.

- Speak to the reader as "you". Say **AI agent** once, in the subtitle, and **your agent**
  everywhere else. Say **Codex** only in the title.
- Use everyday words. Keep a technical word only when it names something the reader can copy,
  such as `AGENTS.md`.
- No adjectives a reader can't check, such as "robust", "seamless", "powerful" or "smart",
  and no exclamation marks.

## Leave out

- A side panel or a list of documents, and a colour legend.
- Schema names, test fixtures, `make` commands, pre-commit hooks, CI, lockfiles, solver names,
  timing details and folder paths.
- The words "merge", "gate", "contracts", "workstream" and "fixtures".
- Personal names, email addresses, account IDs, anything in `.openai/`, secrets and every URL.

## Check before you deliver

Report each item as passed or failed.

- [ ] The board has 90 words or fewer, not counting the title. Give the count.
- [ ] The title and six headings explain the method on their own.
- [ ] Every label sits fully inside its box at 100% zoom.
- [ ] Each colour means one thing, and its meaning is clear from the label beside it.
- [ ] Contrast against the board is at least 4.5:1 for all text.
- [ ] The number matches a fresh run of both commands. Paste the output.
