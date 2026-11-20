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
