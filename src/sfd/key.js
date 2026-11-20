/* The answer keys the AI marks against, one per game.

   PROVISIONAL. This key was drafted by Claude from the structure of the game
   and the ordering rule in Sterman (1989). It is not the author's key and is to
   be replaced. Replace `items` and `variants`, keep the shape:

     task      what the learner is asked to draw (shown on screen)
     scope     what the diagram should cover (for the AI)
     items     what the key requires. id: short and unique; kind: stock | flow |
               auxiliary | link; what: the element's role, in words; names: names
               a learner might use (examples, not a closed list); level: required |
               important | optional
     variants  other structures to accept as correct

   The word-of-mouth game has no key yet (null): the learner can draw and record,
   but the diagram cannot be marked. */
const KEYS = {
  plain: {
    status: 'provisional',
    task: 'Draw a stock-and-flow diagram of your pub that explains what happened in your game: ' +
      'how kegs reach your cellar and leave it, what happens to customers you cannot serve, and how you decide how many kegs to order. ' +
      'Name things in your own words. No equations are needed.',
    scope: 'One position in the chain: the pub. The wholesaler appears only as where deliveries come from (a cloud is enough). Structure only, no equations.',
    items: [
      { id: 'S1', kind: 'stock', what: 'Kegs in the cellar (inventory on hand)', names: ['inventory', 'cellar', 'stock', 'kegs in stock'], level: 'required' },
      { id: 'S2', kind: 'stock', what: 'Kegs owed to customers who could not be served (backlog)', names: ['backlog', 'customers waiting', 'unfilled orders', 'kegs owed'], level: 'required' },
      { id: 'S3', kind: 'stock', what: 'Kegs ordered but not yet received (supply line), including any the wholesaler has on back order', names: ['supply line', 'on order', 'kegs on the way', 'in transit', 'pipeline'], level: 'required' },
      { id: 'F1', kind: 'flow', what: 'Orders placed: fills the supply line', names: ['orders', 'order rate', 'ordering'], level: 'required' },
      { id: 'F2', kind: 'flow', what: 'Deliveries: drains the supply line and fills the cellar', names: ['deliveries', 'arrivals', 'receiving'], level: 'required' },
      { id: 'F3', kind: 'flow', what: 'Kegs served to customers: drains the cellar', names: ['shipments', 'sales', 'serving', 'kegs served'], level: 'required' },
      { id: 'F4', kind: 'flow', what: 'Customer demand coming in: fills the backlog', names: ['incoming orders', 'customer orders', 'demand'], level: 'required' },
      { id: 'F5', kind: 'flow', what: 'Customers served: drains the backlog (the same kegs as F3)', names: ['orders filled', 'customers served'], level: 'important' },
      { id: 'A1', kind: 'auxiliary', what: 'Expected demand: what the player thinks customers will want, formed from recent demand', names: ['expected demand', 'forecast', 'demand estimate'], level: 'important' },
      { id: 'A2', kind: 'auxiliary', what: 'Desired inventory: the stock the player aims to hold', names: ['desired inventory', 'target stock'], level: 'important' },
      { id: 'A3', kind: 'auxiliary', what: 'Customer demand as an outside input (if not drawn as the flow F4 itself)', names: ['customer demand', 'customers'], level: 'optional' },
      { id: 'L1', kind: 'link', what: 'The cellar (S1) informs the order decision (F1), directly or through a gap or adjustment auxiliary', level: 'required' },
      { id: 'L2', kind: 'link', what: 'The backlog (S2) informs the order decision (F1), directly or through a gap or adjustment auxiliary', level: 'important' },
      { id: 'L3', kind: 'link', what: 'The supply line (S3) informs the order decision (F1). Leaving this out is the classic error of the game: kegs already on the way are forgotten, so the player over-orders.', level: 'required' },
      { id: 'L4', kind: 'link', what: 'Expected demand (A1) informs the order decision (F1)', level: 'important' },
      { id: 'L5', kind: 'link', what: 'Desired inventory (A2) informs the order decision (F1), directly or through a gap auxiliary', level: 'important' },
      { id: 'L6', kind: 'link', what: 'Customer demand informs expected demand (A1)', level: 'important' },
      { id: 'L7', kind: 'link', what: 'The cellar (S1) and the backlog (S2) inform how many kegs are served (F3): you can serve only what you have, and up to what is wanted', level: 'important' }
    ],
    variants: [
      'The supply line (S3) may be drawn as two or more stocks in a row (for example "on the road" and "nearly here", or a separate stock for the back order at the wholesaler), with flows between them. This counts as S3, and L3 then needs links from each of them, or from an auxiliary that adds them up, to the order decision.',
      'The cellar and the backlog may be combined into one net stock that goes negative when customers are owed kegs. This counts as S1 and S2 together, and L1 and L2 as one link from it.',
      'Gaps and adjustments may be drawn as extra auxiliaries (inventory gap, supply line adjustment, effective inventory) between the stocks and the order decision. Links through them count as the direct links.',
      'The order decision may be drawn as an auxiliary that feeds the orders flow (F1). Links into it count as links into F1.'
    ]
  },
  wom: null
};
if (typeof module !== 'undefined') module.exports = KEYS;
