# Physix demo video: brief for a Codex agent

You are a Codex agent producing a landscape (16:9) demo video of Physix for YouTube that
runs between 1:30 and 1:55 (never under 1:00, never over 2:00). You drive the lab yourself, record it, measure every
number you show, write the narration and captions, and edit the cut. The owner records one
ChatGPT segment, because it needs their signed-in account; you prepare it and cut it in.

Read these first, in this order: `AGENTS.md` (evidence rules), `docs/COPYWRITING.md` (voice
and claims), `docs/DESIGN.md` (colours and type), `docs/CHATGPT.md` (the plugin's tools) and
`docs/CONTRACTS.md` (units and conventions). Where this brief and those files disagree,
those files win.

## The story in one line

> A block slides off a ramp into a spring. You find out where its energy goes, then you let
> your agent build the same experiment from a homework problem.

The viewer should leave knowing three things: you can build a mechanics experiment by
dragging parts into place, the lab measures it and checks it against theory, and an AI agent
can set it up from a problem statement.

## Deliverables

Work in a folder outside the repository, such as `../physix-demo/`. Commit nothing from it.

| File | What it is |
| --- | --- |
| `physix-demo-16x9.mp4` | The video: 1920 × 1080, 60 fps, H.264 High, AAC 48 kHz, −14 LUFS integrated, −1 dBTP |
| `thumbnail.png` | 1280 × 720 YouTube thumbnail, built from the hook frame (see "YouTube page") |
| `youtube.md` | Title, description and chapters for the upload (see "YouTube page") |
| `captions.srt` | The narration, timed, to upload as YouTube subtitles |
| `evidence.md` | Every number shown or spoken, with its source run, export file and the date measured |
| `script.md` | The final narration and on-screen text, with timings |
| `raw/` | Unedited captures and CSV exports, named by segment |

## Retention rules

These come from short-form work that held viewers to the end, adapted to a landscape video.
Apply all of them.

1. **Hook in 1.5 s.** Frame 1 is already moving: the block meeting the spring, cropped tight.
   The hook's number is on screen and in the captions before 1.5 s.
2. **Something new every 2.5 s or less.** Count a cut, a punch-in, a plot line drawing, a
   theory card turning green, a value counting up or an inspector field changing. If a shot
   holds longer, add a punch-in on its key word.
3. **The first 5 s show 4 or more views.** Hook close-up → wide lab → plot → inspector, for
   example. No view in the first 5 s lasts longer than 1.6 s.
4. **At most 6 words on screen at once**, not counting the hero number. A screen holds one
   anchor: the number or the verdict the ear would forget. Never repeat the narration as
   on-screen text.
5. **Show what the narration says, while it says it.** "The spring compresses" plays over the
   coil compressing, not over the next shot.
6. **A turn every 2 or 3 lines.** Use "But", "So", "Then" to carry the viewer across a cut.
7. **One open loop.** Ask the hook's question early and answer it before the end.
8. **Bookend ending.** The last shot restages the first shot, so the video ends where it
   began.
9. **The voice always wins.** Music bed at about −24 dB under the voice and ducked a further
   10 dB while the voice speaks. Effects never cover a word. Master to −14 LUFS.

## Visual rules

- **Captions:** 1 to 3 words at a time, bold white Inter 600 with a dark outline, centred at
  70% of the frame height. Numbers and units in yellow `#FFD84A`. Chunks break at commas
  and full stops and never end on "the", "a", "of" or "for".
- **Safe area:** keep all text out of the bottom 12% of the frame, where YouTube's progress
  bar and controls appear, and 5% in from every edge.
- **Hero numbers:** a card in the lab's own style. Use background `#f9fbf7` at 94% opacity,
  ink `#263229`, Inter 600 with tabular figures, and units in `#59695d`. The hero is at least
  90 px tall in the 1080 p frame and counts up to its value in 0.4 s with an ease-out.
  - Accent green `#32664e` for a check that passes.
  - Amber `#b07a1a` for a loss of energy.
  - Purple `#6c408a` for a theory reference, which matches the lab's reference colour.
- **Punch-ins:** zoom from 100% to 112% on the key word over 0.35 s, ease-out. Never zoom
  past the capture's native resolution: capture at 2560 × 1440 and edit on a 1920 × 1080
  timeline.
- **Cursor:** show it, enlarged by about 1.5×, with a soft click ring. Move it in smooth
  arcs; no jittery paths. Hide it whenever it isn't doing something.
- **Transitions:** hard cuts by default. Use at most three motivated transitions: a quick
  zoom into the energy plot, a whip for "Or skip the clicks", and a flash back to the
  opening shot.
- **Bright and calm.** The lab is a light, pastoral interface. Keep it that way: no dark
  overlays, no glitch effects and no emoji.

## Setup

1. From the repository root, run `make setup` once, then build and serve the production web
   app so frames are smooth: `pnpm --filter @physix/web run build`, then
   `pnpm --filter @physix/web run preview`.
2. Drive Chromium with Playwright at a 2560 × 1440 viewport and a device scale factor of 1.
   Capture the window at 60 fps with ffmpeg, or use a CDP screencast for drafts. Keep the
   browser chrome out of frame.
3. Open each scene by its URL so every take starts identically:
   - `#/lab?study=motion&template=bumper` (Ramp into a spring bumper);
   - `#/lab?study=motion&template=springPulley` (Sprung Atwood machine);
   - `#/lab?study=motion&template=blank` for the build segment.
4. Close the toast stack and any panel that a shot doesn't need. Reset the camera from the
   menu (**Reset camera**) before each take.
5. Record each segment as its own take, with 1 s of handles before and after.

## Measuring the numbers

Every number in the video comes from a run you recorded, never from this brief and never
from theory alone.

- After each run, open the dock's **Table** view and use **Export** to save the run's CSV.
  Save it to `raw/` with the segment name.
- Read the value from the CSV, round it to three significant figures (DESIGN.md), and write
  it to `evidence.md` together with the file, the column and the time it applies to.
- A theory value comes from the theory card on the same run, with its Δ and whether it
  passed. If a check doesn't pass, either show it as it is or cut the claim. Never retouch
  a card.
- Say "measured in this run" or show the run on screen. Don't claim speed or accuracy beyond
  what `evidence.md` records.

The script below uses placeholders in braces, such as `{v_hit}`. Replace each with the
measured value before you record the voice.

## Script and shot list

Target 1:45. The narration runs at about 3.2 words per second, roughly 290 words.
"VO" is the narration. "Screen" is the on-screen text besides captions.

### 1. Hook (0:00–0:05)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 0:00 | Tight crop on the bumper as the block hits the pad and the coil compresses. Already moving on frame 1. | "This block hits a spring at {v_hit} metres per second." | Hero: `{v_hit} m/s` |
| 0:01.5 | Cut wide: ramp, block rebounding, bumper. | "It comes back." | — |
| 0:02.5 | Cut to the dock's plot, **Mechanical energy**, the line drawing on. | "But not all of its energy does." | — |
| 0:04 | Punch in on the drop in the line. | "So where did it go?" | `Where did it go?` |

### 2. Context (0:05–0:13)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 0:05 | Home page hero, then a click on **Open the lab**. | "This is Physix, a physics lab that runs in your browser." | — |
| 0:08 | **Templates** opens; the cursor passes the list and stops on **Blank scene**. | "You build an experiment from parts, run it, and measure it." | — |
| 0:11 | Blank scene, empty floor. | "And your AI agent can use the same lab." | `Your agent, same lab` |

### 3. Build it with the move arrows (0:13–0:35)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 0:13 | **Add part** → **Ramp**. The ramp appears. | "Add a ramp." | — |
| 0:15 | **Add part** → **Block**. Select it; the three move arrows appear. | "Add a block, and select it." | — |
| 0:17 | Drag the green Y arrow up, then the red X arrow along the ramp until the block sits on it. Punch in on the arrows. | "Drag an arrow to move it along one axis, a centimetre at a time." | `X · Y · Z` in the arrows' colours |
| 0:22 | **Add part** → **Bumper**. Drag its red X arrow to the foot of the ramp. | "Then add a spring bumper where the block will land." | — |
| 0:26 | Inspector: set **Stiffness k** to 400 N/m. The value types on. | "Give it a stiffness of 400 newtons per metre." | Hero: `k = 400 N/m` |
| 0:30 | Press **Run**. The block slides, hits the pad, rebounds up the ramp. | "Then run it." | — |

If the built scene doesn't match the template's behaviour closely enough to measure, cut to
the template from step 3 of Setup at 0:30 and say nothing about the swap; both use the same
parts and values. Record the values of the scene you actually measure.

### 4. The turn: find the energy (0:35–0:55)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 0:35 | Select the bumper. Plot **Elastic energy**: three spikes, each smaller. | "Each time it hits, the spring stores the energy and hands it back." | Hero: `{U_peak} J` |
| 0:40 | Switch to the system's **Mechanical energy**. It is flat through each spring contact. Punch in on a flat section. | "Through the spring, the total holds steady." | `Flat through the spring` |
| 0:45 | Punch in on the step at the foot of the ramp. | "But at the foot of the ramp, it drops." | Hero: `−{dE_foot} J` (amber) |
| 0:49 | Scrub to the moment the block reaches the floor; the plot cursor sits on the step. | "That's the impact with the floor. The vertical speed is lost there, not in the spring." | — |

This answers the hook. Check the numbers against the CSV: the elastic peak, and the
mechanical energy just before and after the ramp-foot step.

### 5. Escalation: a spring under an Atwood machine (0:55–1:13)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 0:55 | Whip to `template=springPulley`. Run. The weights bob. | "Now hang a spring under one weight of an Atwood machine." | — |
| 0:59 | Plot the right weight's height: a clean oscillation. | "It doesn't fall anymore. It oscillates." | — |
| 1:03 | Theory panel: the period card turns green with its Δ. Punch in. | "And the lab checks the period against the closed form: {dT} off." | Hero: `Δ {dT}` (green) |
| 1:08 | Inspector: raise **Spring k**; re-run; the oscillation tightens. | "Stiffen the spring, and it swings faster." | — |

### 6. Twist: let your agent build it (1:13–1:35)

The owner records this segment in ChatGPT with the Physix plugin connected (see
`docs/CHATGPT.md`). Prepare the prompt and send it to them:

> A 2 kg block starts from rest at the top of a 5 m ramp at 30° with friction 0.1, slides
> onto a frictionless floor and hits a spring bumper with k = 400 N/m. Simulate it and plot
> the block's speed and the spring's compression. How far does the spring compress?

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 1:13 | Whip to the ChatGPT chat as the prompt is sent. | "Or skip the clicks. Ask ChatGPT with the Physix plugin." | — |
| 1:18 | The answer streams in: the values it quotes and the plotted graph. Punch in on the compression value. | "It builds the scene, runs it on the lab's engine and reports what it measured." | Hero: `{d_max} m` |
| 1:25 | Click the scene link. The same scene opens in the lab and runs. | "Then it links you to the same experiment, so you can check it yourself." | — |

Quote only values that the chat shows and that match the linked run. If the chat's reply
differs from the run, use the run's value and say so in `evidence.md`.

### 7. Breadth, then back to the start (1:35–1:50)

| Time | Picture | VO | Screen |
| --- | --- | --- | --- |
| 1:35 | Switch to **Stress**: the plate's von Mises field with its source label. | "The same lab also has a 2D stress study, checked against finite element results." | — |
| 1:41 | Back to Motion, the bumper template, camera low by the spring. | "So where would you put the spring?" | — |
| 1:44 | Restage the opening crop: the block meets the pad. Flash transition back to frame 1. | "Open the lab and try it." | `physix-lab.hospitablepeacock.chatgpt.site` |

The last frame matches the first, so the video ends where it began.

## Sound

- **Narration:** a calm, conversational voice at 3.2 to 4 words per second. Cut pauses
  inside a line to 0.2 s, or 0.3 s after a full stop. Allow one longer pause, 0.4 s, before
  "But at the foot of the ramp".
- **Music:** a light, instrumental bed with a steady pulse, about 100 to 115 BPM, licensed
  for this use. Record its title and licence in `evidence.md`.
- **Effects:** at most one soft tick when the spring is hit in the hook, and one soft chime
  when the theory card turns green. Never stack two effects, and never let one cover a word.
- **Check:** play the master on a phone speaker at half volume. Every word must be clear.

## YouTube page

- **Thumbnail:** the block meeting the spring, with the hero number and at most 4 words, such
  as "Where did it go?". It must read at 320 × 180, the size of a search result.
- **Title:** under 60 characters, sentence case, and it states what the viewer sees, for
  example "Where a block's energy goes when it hits a spring".
- **Description:** two sentences from `docs/COPYWRITING.md`, the lab's URL, and the chapters
  below. Use only claims the video itself backs with `evidence.md`.
- **Chapters:** YouTube needs the first at 0:00 and each at least 10 s long. Use 0:00 "The
  question", 0:13 "Build it with the move arrows", 0:35 "Find the energy", 0:55 "A spring
  under an Atwood machine", 1:13 "Let ChatGPT build it", 1:35 "Stress study". Shift them to
  match the final edit.

## Copy rules

Follow `docs/COPYWRITING.md`.

- Speak to the viewer as "you". Say "AI agent" once, then "your agent".
- Use the interface's words: **Add part**, **Run**, **Templates**, **Stiffness k**,
  **Mechanical energy**.
- Call a simulated value "measured in this run" or "simulated". Call a closed-form value
  "theory" and give its Δ. Call a stress result an "FEM reference".
- No exclamation marks, no "revolutionary", "powerful", "seamless" or similar adjectives,
  and no speed claims unless `evidence.md` has a timing with hardware and boundaries.
- Don't show personal names, email addresses, account details or any value from `.openai/`.

## Check before you deliver

- [ ] Runtime is between 1:30 and 1:55.
- [ ] The hook's number is on screen and in the captions before 1.5 s.
- [ ] No view in the first 5 s lasts longer than 1.6 s, and nothing on screen stays the same
      for more than 2.5 s anywhere.
- [ ] No screen carries more than 6 words besides its hero number.
- [ ] Every number on screen or in the voice is in `evidence.md` with its CSV or theory card,
      and matches it after rounding.
- [ ] The move arrows, the bumper's energy plot, the sprung Atwood's theory check, and the
      agent building a scene all appear.
- [ ] The last shot restages the first.
- [ ] Integrated loudness is −14 LUFS ±1, true peak ≤ −1 dBTP, and the voice is clear on a
      phone speaker.
- [ ] No text sits in the bottom 12% of the frame, and the thumbnail reads at 320 × 180.
- [ ] The chapters in `youtube.md` match the final edit's timings.
- [ ] The console showed no errors during capture, and no take shows a toast or a dev
      overlay.
