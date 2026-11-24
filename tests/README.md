# Beer Game Lab: tests

The tests measure how well Beer Game Lab evaluates a learner's diagram. There are 59 test diagrams, each with an expected result, and a test page that runs them all.

## Running the tests

Open `tests/runner.html` (on GitHub Pages: the app's address followed by `tests/runner.html`). The page is not linked from the app, and learners never see it.

1. **Models.** One row per model: provider, model, key and number of runs. Keys stay in the page's memory and go only to the provider. Leave the model blank for the provider's default in the app.
2. **Diagrams.** All 59, or some groups, or a list of IDs.
3. **Start.** Each diagram goes through `Evaluate.run`, the same evaluation a learner's submission gets, with the same prompts and rules. A typical panicky game and a typical first explanation are given to the wording call, the same for every run, except G10, which has its own explanation.
4. **Results.** Download the results file (JSON), the report (Markdown) and the slides for rating (CSV).

**Rehearsal** is a model that needs no key: it reads every diagram exactly as the key says. Run it first to see a whole run and its report for free. It should score 100% on every measure, except on the four diagrams where the rules disagree with the key (G1–G4; see Q3): there its verdicts are the rules', so they count as false passes.

The page keeps a copy of the results in the browser, so a closed page can carry on where it stopped. **Continue from a results file** does the same from a downloaded file; Start then runs only what is missing. **Clear results** starts again.

## What the report measures

| Question | Measure |
| --- | --- |
| Q1. Reading | Share of elements read as the key says (the same concepts, or both an extra) |
| Q2. Verdicts | Share of mechanism verdicts (M1–M10) matching the key; false failures and false passes counted apart |
| Q3. Rules | The rules applied to the key's own reading, against the key's verdicts (no AI) |
| Q4. Wording | Rated by hand: fill in the four y/n columns of the slides file |
| Q5. Consistency | Share of diagrams whose repeated runs with one model gave identical verdicts, and identical readings |
| Q6. Names and layout | Share of runs in which A2, A3, E3 and E4 got the same verdicts as A1 in the same run |
| Q7. Safe failure | Runs stopped as unreadable, runs that failed, second readings, and verdicts given on an incomplete reading |
| Q8. Cost | Median time and tokens per evaluation |

The report also lists every wrong verdict, every misread element, every diagram whose verdicts changed between runs, and every name or layout change that changed the verdicts.

## Reproducibility

- The reading call runs at temperature 0; a model that does not take a temperature is asked again without one, and the results say so. Gemini 3.5 and later are not sent one at all, since Google says they ignore it: their results say "not accepted", and their runs should not be described as made at temperature 0. The wording runs at the model's default.
- The results file holds everything needed to re-score the runs exactly, even after the models change: the app version, the settings, the prompts, the game given to the wording, and for every run the reading, verdicts, slide texts, each AI call's raw answer, time and tokens.
- Re-score a results file from the command line: `node tests/score.js results.json [key.json] > report.md`.
- Use dated model versions rather than aliases, and tag the repository version used for a published set of results.

## Files

- `diagrams/*.json`: the 59 diagrams. Each can also be imported into the app with **Import a diagram (JSON)**.
- `hand/F*.json`: the author's hand-drawn diagrams as he drew them; `build_tests.js` copies them into `diagrams/` with the rest.
- `key.csv`, `key.json`: the expected result of each diagram, and the expected reading of every element. A second element of the same name is shown as "(2)"; each flow is shown with its ends.
- `build_tests.js`: builds the diagrams and the key from the author's reference and checks each against the rules (`node tests/build_tests.js`). `CHECK_DIR=<folder>` checks diagrams saved from the app after import instead.
- `score.js`: the scoring, used by the page and from the command line.
- `runner.js`, `runner_body.html`, `runner.css`: the test page's sources. `build.py` in the repository's root builds `runner.html` from them, with the diagrams and the key built in.

**Please check the key.** It stands as the author's judgement: change any row you disagree with in `key.json`, then rebuild, or load it into the page with **Load a different key**. A row where the author expects a different verdict from the rules' is a finding about the rules (Q3).

There is no C5: it was to test N5 (a flow attached at one end), but the canvas cannot hold such a flow, so a learner can never make that error.

## The test diagrams

| Group | Diagrams | What it tests |
| --- | --- | --- |
| A. Correct | A1–A8 | The reference, renamed, relaid and built differently: nothing should fail |
| B. One mechanism broken | B1–B10 | Each of M1–M10 broken once |
| C. One notation rule broken | C1–C4, C6–C10 | Each notation check that can occur, triggered once |
| D. Several errors | D1–D5 | Mixed errors, including the author's first draft (D2) and a learner's diagram (D3) |
| E. Unrelated or misleading | E1–E4 | An unrelated diagram, and names that contradict the structure |
| F. Drawn by hand | F1–F13 | The author's own diagrams, drawn in the app: his model of the game (F1), one change to it in each of F2–F12, and an unrelated diagram (F13) (below) |
| G. From the literature | G1–G10 | Errors reported in the studies, planted in a learner's diagram (below) |

Every diagram was checked against the rules with its expected reading, as built and after import into the app, where the canvas moves each valve to the middle of its flow. Both give the expected result for 55 of the 59. The other four (G1–G4) are errors the rules are not built to catch: the rules check that what the game needs is there, not that a wrong link or a second flow is absent. For these the key gives the author's verdict, and `key.json` also records what the rules give (`rules_give`).

### Group F: drawn by hand

The author drew these in the app; they are kept exactly as drawn (`hand/`), typos in the names included. F1 is his own model of the game, built differently from A1: a stock of served customers, the kegs on order as two stocks ("orders" and "deliverables") and a "delay factor". The expected reading maps his elements to the concepts; the expected verdicts are the rules', for him to confirm.

| Test | The change from F1 | Expected |
| --- | --- | --- |
| F1 | None | Nothing fails |
| F2 | An auxiliary "pub hours" linked to nothing | W2 |
| F3 | A cloud attached to nothing | Nothing: no rule covers a loose cloud |
| F4 | A stock "a" attached to nothing | N8 |
| F5 | The order flow named "keg order stock" | Nothing: no rule covers names; tests the reading |
| F6 | Failing to serve informs serving, instead of the other way round | Nothing: an equally valid way to draw it |
| F7 | The player decision linked to the orders stock | N2 and W1 |
| F8 | The player decision drawn as a stock | N8 |
| F9 | A stock "wholesaler", filled from a cloud, that the orders flow out of | W1 (the flow into it is informed by nothing) |
| F10 | No player decision and no order flow | M2 fails |
| F11 | The order flow drawn as a stock "keg order rate", emptied by a flow "kegs" into the orders | Nothing: no rule covers names; tests the reading |
| F12 | No link from the player decision to the order flow | W1 and W2 |
| F13 | An unrelated diagram (rabbits) | All ten mechanisms fail |

### Group G: errors from the literature

Most of the errors reported in the studies come from language models building models. Here they are planted in a learner's diagram, to see whether the AI reader, and the rules, catch them. Errors in equations, units and link polarities are left out: the exercise has none of them.

| Test | What is planted | Source | Expected |
| --- | --- | --- | --- |
| G1 | Double count: the kegs for customers served on arrival leave the cellar twice | Akhavan & Jalali (2024): net exports counted twice | M5 fails; the rules miss it |
| G2 | Double count: every arriving customer also joins the waiting customers | Akhavan & Jalali (2024) | M6 fails; the rules miss it |
| G3 | Invented link: the cellar informs the customers coming in | Schoenberg et al. (2025): invented relationships; Leitch (2026): extra links | M8 fails; the rules miss it |
| G4 | Invented link: the orders inform the deliveries | Schoenberg et al. (2025); Leitch (2026) | M1 fails; the rules miss it |
| G5 | Reversed flow: the deliveries run from the cellar back to the kegs on order | Schoenberg et al. (2025): the two ends of a link swapped | M1 fails |
| G6 | Reversed link: the orders inform the player's decision | Schoenberg et al. (2025) | W1 and W2 |
| G7 | Larger and correct: the wholesaler's cellar, its kegs on order and the brewery added (8 stocks) | Campuzano-Bolarín et al. (2026): larger models need major corrections; Park et al. (2026): performance falls with complexity | Nothing fails |
| G8 | The total cost drawn as an auxiliary | Bravo et al. (2009): learners mix up types of element | M9 and M10 fail, and W2 |
| G9 | The waiting customers drawn as an auxiliary | Bravo et al. (2009) | M6, M7 and M9 fail, and N6 |
| G10 | The reference, with a confident but wrong explanation from the learner | Akhavan & Jalali (2024): the model agreed readily with the user | Nothing fails; rate the wording by hand: it should not agree |

In G8, M10 fails because the rules find no cost flow to check, as in D3 and D5. In G9, the catching up flow runs between two clouds once the waiting customers are an auxiliary (N6), and the cost is no longer informed by a stock of waiting customers (M9).
