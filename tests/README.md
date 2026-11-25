# Beer Game Lab: tests

The tests measure how well Beer Game Lab's feedback catches the flaws in a learner's diagram. There are 59 test diagrams, an **answer sheet** that lists each one's flaws, and a test page that runs them all and marks the results.

## Running the tests

Open `tests/runner.html` (on GitHub Pages: the app's address followed by `tests/runner.html`). The page is not linked from the app, and learners never see it.

1. **Models.** One row per model: provider, model, API key and number of runs. API keys stay in the page's memory and go only to the provider. Leave the model blank for the provider's default in the app.
2. **Diagrams.** All 59, or by type of flaw and designer, or a list of id numbers.
3. **Start.** Each diagram goes through `Evaluate.run`, the same evaluation a learner's submission gets, with the same prompts and rules. A typical panicky game and a typical first explanation from the learner are given to the wording, the same for every run, except id 10, which has its own explanation.
4. **Results.** Download the results file (JSON), the report (Markdown) and the explanations to rate (CSV). Nothing is downloaded on its own: press the buttons. They work as soon as one run has finished, so you can save the results so far at any time.

**Rehearsal** needs no API key: it classifies every element exactly as the answer sheet says. Run it first to see a whole run and its report for free. It shows the best this design can do: every flaw the rules can see is flagged (TP), and nothing else (no FP).

The page keeps a copy of the results in the browser, so a closed page can carry on where it stopped. **Continue from a results file** does the same from a downloaded file; Start then runs only what is missing. **Clear results** starts again. The browser's copy holds only about 5 MB, so on a long run, download the results now and then.

## The tests and their names

The 59 tests are numbered **id 1** to **id 59**. Each also has a name that says what it holds, for example `Co-1-double_count-lit`:

1. **The type of its flaws:** `NA` none (a correct diagram), `Sy` syntactic, `Co` conceptual, `SyCo` both.
   - **Syntactic:** the drawing breaks the stock-and-flow notation, whatever it models: a link into a stock, a flow between two clouds, two elements with the same name.
   - **Conceptual:** valid notation that does not represent the game correctly: something wrong, missing, extra, misnamed, drawn as the wrong type, or outside the boundary.
2. **The number of flaws:** each flaw is one correction the feedback should make. An unrelated diagram has one: it is unrelated.
3. **Their kind:** for one or two flaws, the kind of each (`wrong_link`, `missing_stock`, `misjudged_rate`…); for three or more, `mixed`.
4. **Who designed it:** `author`, `claude`, or `lit` (Claude, from errors reported in the literature).

They are numbered in that order: the correct diagrams first (id 1–10), then syntactic, conceptual and both, by designer within each. All 59, with their flaws, are listed in [`answer_sheet.md`](answer_sheet.md).

## The answer sheet

`answer_sheet.json` (to read: `answer_sheet.md`, or `answer_sheet.csv` for a spreadsheet) has, for each test:

- **its flaws**, in plain words, each with its type and kind;
- **what counts as catching each flaw**: anything in the feedback that points the learner to it. That can be a notation error or warning, a mechanism shown as not working, a note that an element is drawn as the wrong type (a stock drawn as an auxiliary, a rate drawn as a stock), the AI listing an element as not part of the game, or the message that the diagram shows only a few of the game's parts. A flaw nothing in the design can catch has an empty list: it shows what the design cannot see;
- **the classification the AI should give**: the part of the game each element stands for, or that it is not part of the game. A second element of the same name is shown as "(2)"; each flow is shown with its ends.

Change anything you disagree with in `build_tests.js` and rebuild (`node tests/build_tests.js`, then `python3 build.py`), or edit `answer_sheet.json` and load it into the page with **Load a different answer sheet**. The results need not be run again: they are marked against whichever answer sheet is loaded. Results recorded under the labels of earlier versions (A1, B7…) are marked too: the answer sheet keeps each old label.

## What the report counts

For every run of every diagram:

| | Meaning |
| --- | --- |
| **TP** (true positive) | A flaw on the answer sheet that the feedback flags |
| **FN** (false negative) | A flaw on the answer sheet that the feedback does not flag |
| **FP** (false positive) | A flag that no flaw on the answer sheet explains, counted apart for the rules and for the AI (an element of the game that the AI classifies as not part of it) |
| **TN** (true negative) | One of the 22 rule checks that stayed silent where nothing was wrong |

One flaw often sets off several flags: they count as one TP, and none is an FP. An element the answer sheet itself classifies as not part of the game, classified so by the AI too, is neither a TP nor an FP unless a flaw names it: the AI is then only describing the diagram.

From these: **recall** = TP / (TP + FN), **precision** = TP / (TP + FP), **specificity** = TN / (TN + FP of the rules), since TN counts the rule checks, and **F1** = 2TP / (2TP + FP + FN). The same is counted per diagram: a flawed diagram is a TP if at least one of its flaws is flagged and an FN if none is; a correct diagram is an FP if anything is flagged and a TN if nothing is.

The report gives these per model, for syntactic and conceptual flaws apart, and for each kind of flaw; says whether each TP was flagged by the rules, by the AI, or by both; and lists every FN and every FP. It also gives **the rules alone**: TP, FN and FP when the rules are given the answer sheet's own classification of the elements, so with no AI, which is the most the rules can do.

Underneath, supporting measures: the AI's **classification accuracy** (the share of elements it assigns to the same part of the game as the answer sheet, or, like the answer sheet, to none) and which elements it classified differently; whether repeated runs gave the same flags and classification; whether names and layout changed anything (renamed and relaid versions of the reference, against the reference); runs stopped because the AI left elements unclassified, or that failed; time and tokens.

**The explanations to rate** (CSV): one row per TP (a flaw flagged), in the first full run of each diagram and model, with what the learner was told about it. Fill in three columns: correct, clear, helps to fix it (y/n). Id 10 has a row of its own: whether the feedback went along with the learner's wrong explanation.

## Reproducibility

- The AI's classification of the elements is asked for at temperature 0; a model that does not take a temperature is asked again without one, and the results say so. Gemini 3.5 and later are not sent one at all, since Google says they ignore it: their results say "not accepted", and their runs should not be described as made at temperature 0. The wording runs at the model's default.
- The results file holds everything needed to mark the runs again exactly, even after the models change: the app version, the settings, the prompts, the game given to the wording, and for every run the AI's classification, what was flagged, the feedback's texts, each AI call's raw answer, time and tokens.
- Mark a results file from the command line: `node tests/score.js results.json [answer_sheet.json] > report.md`.
- Use dated model versions rather than aliases, and tag the repository version used for a published set of results.

## Files

- `diagrams/idNN_<name>.json`: the 59 diagrams. Each can also be imported into the app with **Import a diagram (JSON)**.
- `hand/author_01.json` … `author_13.json`: the author's hand-drawn diagrams as he drew them (his tests 1 to 13); `build_tests.js` copies them into `diagrams/` under their new numbers.
- `answer_sheet.json`, `answer_sheet.md`, `answer_sheet.csv`: the answer sheet.
- `build_tests.js`: builds the diagrams and the answer sheet, and checks that everything the rules flag belongs to a listed flaw (`node tests/build_tests.js`). It also lists the flaws the rules miss even with the answer sheet's classification. `CHECK_DIR=<folder>` checks diagrams saved from the app after import instead.
- `score.js`: the marking, used by the page and from the command line.
- `runner.js`, `runner_body.html`, `runner.css`: the test page's sources. `build.py` in the repository's root builds `runner.html` from them, with the diagrams and the answer sheet built in.

## What the tests show the design can catch

Every diagram was checked against the rules with the answer sheet's classification, as built and after import into the app, where the canvas moves each valve to the middle of its flow. Everything the rules flag belongs to a listed flaw. Of the 64 flaws (15 syntactic, 49 conceptual), the rules alone flag 53 (TP 53, FN 11, FP 0); with the AI classifying the extra elements as not part of the game, the most the design can flag is 54. Nothing in the design can flag:

- misleading names (id 22, 45, 46);
- a loose cloud (id 11);
- a link drawn against the causal direction (id 23);
- double counting (id 47, 48) and invented links (id 49, 50, and one of the flaws in id 56): the rules check that what the game needs is there, not that a wrong link or a second flow is absent. The one invented link they do catch (id 39, the orders informing the cost) is caught because a rule names it: ordering costs nothing.

A slip a learner cannot make is not tested: a flow attached at one end, since the canvas cannot hold one.

## The tests from the literature

Most of the errors reported in the studies come from language models building models. These tests plant them in a learner's diagram, to see whether the feedback catches them. Errors in equations, units and link polarities are left out: the exercise has none.

| id | Name | What is planted | Source |
| --- | --- | --- | --- |
| 47 | `Co-1-double_count-lit` | The kegs for customers served on arrival leave the cellar twice | Akhavan & Jalali (2024): net exports counted twice |
| 48 | `Co-1-double_count-lit` | Every arriving customer also joins the waiting customers | Akhavan & Jalali (2024) |
| 49 | `Co-1-invented_link-lit` | The cellar informs the customers coming in | Schoenberg et al. (2025): invented relationships; Leitch (2026): extra links |
| 50 | `Co-1-invented_link-lit` | The orders inform the deliveries | Schoenberg et al. (2025); Leitch (2026) |
| 51 | `Co-1-wrong_flow-lit` | The deliveries run from the cellar back to the kegs on order | Schoenberg et al. (2025): the two ends of a link swapped |
| 52 | `Co-1-wrong_link-lit` | The orders inform the player's decision | Schoenberg et al. (2025) |
| 53 | `Co-1-broad_boundary-lit` | The wholesaler's cellar, its kegs on order and the brewery added (8 stocks) | Campuzano-Bolarín et al. (2026): larger models need major corrections; Park et al. (2026): performance falls with complexity |
| 54 | `Co-1-misjudged_stock-lit` | The total cost drawn as an auxiliary | Bravo et al. (2009): learners mix up types of element |
| 55 | `Co-1-misjudged_stock-lit` | The waiting customers drawn as an auxiliary | Bravo et al. (2009) |
| 10 | `NA-0-lit` | The reference, with a confident but wrong explanation from the learner: rate by hand whether the feedback goes along with it | Akhavan & Jalali (2024): the model agreed readily with the user |
