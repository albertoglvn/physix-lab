# Physix copywriting guide

Use this guide for the homepage, setup instructions, lab controls, and results.

## Positioning

Lead with what the reader can ask their agent to test. Physix gives AI agents tools to set up
physics experiments and check the results. The first audience is university students working
through a mechanics or stress problem. Write to someone who has a question and wants to see
what changes when they vary one input.

| Workflow | What we can say today |
| --- | --- |
| Stress in ChatGPT | Sign in to Physix with ChatGPT and install the hosted plugin if you have access. Compare supported hole radii and positive load multipliers using scikit-fem reference results. |
| Stress with a local MCP client | Connect the local Physix MCP server to a compatible client. Ask your agent to estimate stress in a supported plate or bracket, compare the estimate with a finite element solve, or search within geometry bounds. |
| Mechanics with an agent | Ask your agent to write or edit a `physix.lab/2` scene. Paste it into Scene JSON to run it in the browser, or run the file with the local CLI. |
| Browser lab | Build a scene from parts or open a template. Change a starting condition, run the experiment, and read the plot. The browser lab also has a separate 2D Stress study. |

Use **AI agent** on first mention for a general audience and **your agent** once the context is
clear. Use **MCP server** in setup, where the reader needs the implementation term. A public
browser lab URL and a local MCP connection each need their own action. Reserve installation,
marketplace and hosted-connector language for integrations people can actually use.

## Browserbase language review

| Surface | Observed pattern | Physix application |
| --- | --- | --- |
| Homepage opening | The hero leads with what the reader's agents gain. The supporting line introduces a familiar technical concept. The primary button names a concrete setup artifact, while a separate setup path addresses agents. | Put the agent use case in the hero. Name the first experiment in the supporting line. Pair **Connect your agent** with **Open the lab**. |
| Homepage use cases and onboarding | Cards start with a job and then give examples using specific objects such as forms, records, or files. The onboarding sequence uses short action headings that move from setup to a first run. | Name the object, changed input, and measured output. Move from configuration to one runnable prompt before listing the rest of the tool surface. |
| Browsers product page | Short claims are followed by tangible details such as isolation, session settings, replay, and code examples. The page moves from what the service provides to what the developer can inspect. | Follow a benefit with an observable result. Show a field, a plot, a versioned case, or a runnable tool call where it helps the reader act. |
| Search product page | The workflow is shown as a sequence of verbs. The mode guide names situations readers recognise and gives scoped timing examples. | Show the sequence a student follows. Give one problem for each workflow and keep performance figures tied to the conditions measured. |
| Microsoft evaluation article | The article names the benchmark, sample count, retry policy, evaluation procedure, and the measures compared. | Put the matched case, mesh, method, and sample count beside any quantitative accuracy claim. Put timing in a separate sentence with its own measurement conditions. |

Browserbase uses broad claims and occasional punch lines in sales copy. Physix earns the same
sense of confidence by naming the problem it can solve and showing how to check the answer.
Use original Physix wording and examples. [Browserbase homepage](https://www.browserbase.com/) ·
[Browsers](https://www.browserbase.com/browsers) ·
[Search](https://www.browserbase.com/search) ·
[Microsoft evaluation article](https://www.browserbase.com/blog/training-computer-use-models-in-the-real-world-with-microsoft)

## Voice and sentence rules

- Address the reader as **you**. Name the actor when it matters, such as **your agent**,
  **the browser lab**, or **the finite element solver**.
- Use active verbs that match the interface. **Connect**, **build**, **run**, **vary**,
  **measure**, **compare**, and **export** all name an action the reader can take.
- Use everyday words for the workflow and keep the technical nouns that distinguish the
  result. Write **change the hole radius** and **compare peak von Mises stress**.
- Write headings in sentence case. Aim for three to nine words and one idea. Use a question
  when it describes a test the reader can run, such as **When does a block slide?**
- Keep body copy to one or two sentences per block. Use the second sentence for a constraint,
  measurement, or next step. Let each sentence add information.
- Keep the tone calm. Cut exclamation marks, filler introductions, vague superlatives, and
  speed or accuracy adjectives that have no measurement attached.

## Patterns by surface

| Surface | Pattern | Example |
| --- | --- | --- |
| Hero | Name the product and audience in the headline. Give one connected workflow and one browser workflow in the body. | **A physics lab for your agent.** |
| Navigation | Use the destination or action. Keep the same label for the same destination. | **Experiments**, **Stress tools**, **Connect your agent** |
| Setup | Name the prerequisite, action, and first result in that order. Put literal paths and commands in code. | **Set `cwd` to the absolute path of your Physix checkout.** |
| Experiment card | Ask a testable question. Give the template name as the secondary label. | **How far will a block travel?** · **Friction track** |
| Control or button | Use a noun with its unit for a field. Use a short verb phrase for a button. | **Mass (kg)** · **Apply scene** · **Copy configuration** |
| Progress or success | Say which action is running or what finished. Include the next step when it helps. | **Solving the stress case…** · **Copied** |
| Error | Name the input or operation, state the limit or reason, and give a recovery step when one exists. | **Angle must be between 5° and 55°.** |
| Result | Put the quantity and unit first. Label the source and explain the basis near the value. | **Peak von Mises stress** · **FEM reference** |

## Engineering claims

- Call an ensemble output a **stress estimate** and a scikit-fem result a **finite element
  result**. When a fallback runs, state why the solver was used. Keep model disagreement and
  measured solver discrepancy in separate statements.
- Use **solver-checked** for the identical case when a matching FEM result exists. Use
  **verified improvement** only when the bounded search has checked both baseline and
  candidate with FEM and the returned result supports the claim.
- Use **2D plane stress** for the supported stress analysis and **3D mechanics** for Motion.
  Preserve geometry, material, load and boundary-condition limits wherever they affect the answer.
- Before publishing accuracy or timing figures, record the conditions required by
  [the engineering instructions](../AGENTS.md). Give the reader the applicable versions,
  units, sample count and mesh for accuracy, and the hardware and timing boundary for performance.

## Before publishing

Read the headline, first paragraph, and primary action together. A reader should be able to
say what Physix will help them test, what connection the test needs, and which step to take
first. Follow every action to its destination. Check that the named controls exist and that
each example uses a supported case or scene. Read result copy beside its units and source.
