# Pub Supply Game

A one-player version of the Beer Game. You run a pub, order kegs from a wholesaler, and try to keep your costs low. The wholesaler, distributor and brewery are played by the computer.

Prototype. Play it at the GitHub Pages address of this repository.

## Rules

- Customers ask for kegs each week. You serve them from your cellar.
- Your order reaches the wholesaler at once. Kegs you order now arrive three weeks later, if the wholesaler has them. What it cannot send goes on back order.
- A keg in your cellar costs £0.50 a week. A keg owed to a customer costs £1 a week. There are no other costs.
- The rules are adapted from Sterman (1989). The computer-played positions use the ordering rule estimated in that paper.

## Files

- `index.html`: the whole app in one file. This is all GitHub Pages needs.
- `src/`: the source (`engine.js` for the rules, `ui.js` for the screen, `style.css`, `body.html`) and `test_engine.js`.
- `build.py`: joins the source into `index.html`. Run `python3 build.py`.

## Reference

Sterman, J. D. (1989). Modeling managerial behavior: Misperceptions of feedback in a dynamic decision making experiment. *Management Science*, 35(3), 321–339.
