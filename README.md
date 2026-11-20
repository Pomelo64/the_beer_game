# Pub Supply Game

A one-player supply chain game. You run a pub and order kegs from a wholesaler. The wholesaler, distributor and brewery are played by the computer.

Prototype. Play it at the GitHub Pages address of this repository.

The game is the first part of an exercise in system dynamics. To do the exercise that follows it, a player needs the basics of stock-and-flow diagrams. Anyone can play the game itself.

## Help on screen

The first time someone plays, a short tour of speech bubbles points to each part of the screen and says what it shows. The **Show me around** button repeats it at any time. During a game, a bubble also appears the first time something important happens: the wholesaler runs short, customers are left waiting or turned away, or the cellar overflows.

## Two games

The opening screen offers two games. The supply game is the default.

**The supply game**

- Customers ask for kegs each week. You serve them from your cellar. A customer you cannot serve waits.
- Your order reaches the wholesaler at once. Kegs you order now arrive three weeks later, if the wholesaler has them. What it cannot send goes on back order.
- A keg in your cellar costs £0.50 a week. A keg owed to a customer costs £1 a week. There are no other costs.
- The score is your total cost.

**Word of mouth**

- Ordering and delivery work as above.
- Your cellar holds 20 kegs. Kegs from a delivery that do not fit are sent back.
- A customer you cannot serve leaves. Word gets around: the crowd shrinks with each customer turned away, and grows after a week in which everyone was served. Lost regulars come back quickly, one a week. New customers are won more slowly.
- The score is the number of customers served. There is no money in this game.

## After the game: modelling it

Once a game starts, the page has two tabs: **The game** and **Your model**. In the model tab the learner draws a stock-and-flow diagram of the pub, has it marked by an AI against an answer key, and can ask the AI questions about it. The tab is open from the first week to the end, so the learner can draw while playing, after it, or both. The diagram carries over to the next game.

While a game is running, the AI is given only the weeks already completed, and nothing from the distributor or brewery, which the player cannot see.

- **The canvas** is SFD Studio's drawing canvas (`src/sfd/canvas.html`), copied unchanged. The build hides only its Edit mode, since this exercise has no equations. It runs in a frame and talks to the page through the same messages it uses with Streamlit.
- **The answer key** is in `src/sfd/key.js`, one per game. The current key is a provisional draft and should be replaced. The word-of-mouth game has no key yet, so its diagrams can be drawn and recorded but not marked.
- **The AI** is called straight from the browser with a key the learner pastes under *AI settings* (Anthropic, OpenAI or Google, as in SFD Studio). The key is kept only in the page's memory. The marking and the answers are grounded in the key, the learner's diagram and the learner's own game.
- **The record**: one record for the session, in SFD Studio's modelling-process format (`bluejay-modelling-process`, version 1, SHA-256 chain). It holds every change to the diagram, every exchange with the AI and every reason the learner gives, and, in time order between them, each game played: a `game` event when it starts, a `week` event for each week played and a `game_end` event. The downloaded file opens, verifies and replays in SFD Studio, which passes over the game events in its replay.

The recording code (`src/sfd/process_log.js`) and the AI client (`src/sfd/llm_client.js`) are ports of SFD Studio's `process_log.py` and `llm_client.py`.

## Where the rules come from

The supply chain is that of the Beer Game as described in Sterman (1989), and the three computer-played positions use the ordering rule estimated in that paper.

The supply game follows it with two changes: the units are renamed (keg, pub, brewery), and the order delay is removed, so delivery takes three weeks from ordering.

Word of mouth adds four more: the pub's customers do not wait, the crowd depends on how it was served, the cellar has a limit, and there is no money. The numbers behind these (cellar size, how fast the crowd grows and recovers, how many people one turned-away customer puts off) are design choices of this game, not estimates from any source. They are set in `CFG` at the top of `src/engine.js`.

## Files

- `index.html`: the whole app in one file. This is all GitHub Pages needs.
- `src/`: the source (`engine.js` for the rules, `ui.js` for the screen, `style.css`, `body.html`) and `test_engine.js`.
- `build.py`: joins the source into `index.html`. Run `python3 build.py`.

## Reference

Sterman, J. D. (1989). Modeling managerial behavior: Misperceptions of feedback in a dynamic decision making experiment. *Management Science*, 35(3), 321–339.
