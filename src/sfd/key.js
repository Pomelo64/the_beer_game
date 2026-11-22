/* The answer keys the AI marks against, one per game.

   Shape of a key:
     status     'author' (the course's own key) or 'provisional'
     source     where the key comes from
     game       how the game works, in words (for the AI that reads the learner's diagram)
     task       what the learner is asked to draw (shown on screen)
     scope      what the diagram should cover (for the AI)
     reference  the reference stock-and-flow diagram, in the canvas's JSON format
     inputs     what the reference treats as outside inputs. A learner may model
                any of these instead; that is not an error
     items      what the marking checks, derived from the reference. id: short and
                unique; kind: stock | flow | auxiliary | link; what: the element's
                role, in words; names: names a learner might use (examples, not a
                closed list); level: required | important | optional
     variants   other structures to accept as correct

   The word-of-mouth game has no key yet (null): the learner can draw and record,
   but the diagram cannot be marked. */
const KEYS = {
  plain: {
    status: 'author',
    source: 'The author\'s reference diagram of the supply game (20 November 2026), with one link corrected: ' +
      '"catch up rate" is informed by "waiting to serve", not by "pub customers".',
    // how the game works, as the player is told it on screen; given to the AI that reads the diagram
    game: 'The learner plays the pub in a one-player supply game (brewery, distributor, wholesaler, pub). Each week customers come in, and each wants one keg. ' +
      'The pub serves them from its cellar and orders more kegs from its wholesaler. The wholesaler gets the order at once and says what it can send; ' +
      'the kegs reach the pub three weeks later. When the wholesaler runs short it sends what it can and keeps the rest on back order, to send later: nothing ordered is lost. ' +
      'A customer the pub cannot serve does not leave: they wait, and are served first when kegs arrive. ' +
      'Each week every keg in the cellar costs £0.50 and every keg owed to a waiting customer costs £1. These are the only costs: ordering and the kegs themselves are free. ' +
      'The player\'s one decision each week is how many kegs to order, and the goal is to keep the total cost low.',
    task: 'Draw a stock-and-flow diagram of your pub that shows how the game works: how kegs reach your cellar and leave it, ' +
      'what happens to customers you cannot serve, and what your cost depends on. Your orders can come from outside the diagram, as an input. ' +
      'Name things in your own words. No equations are needed.',
    scope: 'One position in the chain: the pub, as the game works. The player\'s ordering decision, the customers\' arrivals and the wholesaler\'s ' +
      'ability to deliver are inputs from outside the diagram. Structure only, no equations.',
    reference: {
      stocks: [
        { label: 'pub customers', x: 364, y: 38 }, { label: 'waiting to serve', x: 569, y: 227 }, { label: 'pub cellar', x: 647, y: 344 },
        { label: 'cost', x: 981, y: 489 }, { label: 'registered order', x: 364, y: 344 }],
      auxiliaries: [
        { label: 'arrival plan by week', x: -10, y: 340 }, { label: 'wholesaler provision capacity', x: 364, y: 596 }, { label: 'player decision', x: 151, y: 435 }],
      clouds: [
        { label: 'cloud', x: 36, y: 38 }, { label: 'cloud', x: 876, y: 31 }, { label: 'cloud', x: 602, y: 484 },
        { label: 'cloud', x: 993, y: 342 }, { label: 'cloud', x: 967, y: 219 }, { label: 'cloud', x: 107, y: 348 }],
      flows: [
        { label: 'coming in rate', from: 'cloud', to: 'pub customers' },
        { label: 'serving rate', from: 'pub customers', to: 'cloud' },
        { label: 'failed-to-serve rate', from: 'pub customers', to: 'waiting to serve' },
        { label: 'cost rate', from: 'cloud', to: 'cost' },
        { label: 'consumption rate', from: 'pub cellar', to: 'cloud' },
        { label: 'catch up rate', from: 'waiting to serve', to: 'cloud' },
        { label: 'beer arrival rate', from: 'registered order', to: 'pub cellar' },
        { label: 'order rate', from: 'cloud', to: 'registered order' }],
      connectors: [
        { from: 'arrival plan by week', to: 'coming in rate' },
        { from: 'pub cellar', to: 'cost rate' }, { from: 'waiting to serve', to: 'cost rate' },
        { from: 'pub customers', to: 'serving rate' }, { from: 'pub cellar', to: 'serving rate' },
        { from: 'pub customers', to: 'failed-to-serve rate' }, { from: 'serving rate', to: 'failed-to-serve rate' },
        { from: 'serving rate', to: 'consumption rate' }, { from: 'catch up rate', to: 'consumption rate' },
        { from: 'pub cellar', to: 'catch up rate' }, { from: 'waiting to serve', to: 'catch up rate' },
        { from: 'player decision', to: 'order rate' },
        { from: 'wholesaler provision capacity', to: 'beer arrival rate' }, { from: 'registered order', to: 'beer arrival rate' }],
      junctions: []
    },
    inputs: ['player decision (how many kegs to order)', 'arrival plan by week (how many customers come)', 'wholesaler provision capacity (what the wholesaler can send)'],
    items: [
      { id: 'S1', kind: 'stock', what: 'pub cellar: kegs on hand', names: ['cellar', 'inventory', 'stock', 'kegs in stock'], level: 'required' },
      { id: 'S2', kind: 'stock', what: 'waiting to serve: customers owed a keg (the backlog)', names: ['backlog', 'customers waiting', 'unfilled orders', 'kegs owed'], level: 'required' },
      { id: 'S3', kind: 'stock', what: 'registered order: kegs ordered but not yet arrived, including any the wholesaler holds on back order (the supply line)', names: ['kegs on order', 'on order', 'supply line', 'in transit', 'kegs on the way'], level: 'required' },
      { id: 'S4', kind: 'stock', what: 'cost: the total cost so far', names: ['total cost', 'cumulative cost', 'cost so far'], level: 'required' },
      { id: 'S5', kind: 'stock', what: 'pub customers: the customers in the pub this week, before they are served or left waiting', names: ['customers', 'customers in the pub', 'demand this week'], level: 'important' },
      { id: 'F1', kind: 'flow', what: 'order rate: fills the registered order (S3)', names: ['orders', 'ordering', 'orders placed'], level: 'required' },
      { id: 'F2', kind: 'flow', what: 'beer arrival rate: drains the registered order (S3) into the cellar (S1)', names: ['deliveries', 'arrivals', 'receiving'], level: 'required' },
      { id: 'F3', kind: 'flow', what: 'coming in rate: customers arriving (fills S5)', names: ['arrivals of customers', 'customer demand', 'incoming customers'], level: 'required' },
      { id: 'F4', kind: 'flow', what: 'serving rate: customers served this week (drains S5)', names: ['serving', 'sales', 'customers served'], level: 'required' },
      { id: 'F5', kind: 'flow', what: 'failed-to-serve rate: customers not served move from S5 into the backlog (S2)', names: ['unserved customers', 'shortfall', 'left waiting'], level: 'required' },
      { id: 'F6', kind: 'flow', what: 'catch up rate: waiting customers served later (drains S2)', names: ['backlog served', 'catching up', 'orders filled late'], level: 'required' },
      { id: 'F7', kind: 'flow', what: 'consumption rate: kegs leaving the cellar (drains S1), equal to serving plus catching up', names: ['shipments', 'kegs served', 'kegs out'], level: 'required' },
      { id: 'F8', kind: 'flow', what: 'cost rate: the cost added each week (fills S4)', names: ['weekly cost', 'cost per week', 'cost increase'], level: 'required' },
      { id: 'A1', kind: 'auxiliary', what: 'arrival plan by week: how many customers come (an outside input)', names: ['customer demand', 'demand pattern'], level: 'important' },
      { id: 'A2', kind: 'auxiliary', what: 'wholesaler provision capacity: what the wholesaler can send (an outside input)', names: ['wholesaler stock', 'supplier capacity'], level: 'important' },
      { id: 'A3', kind: 'auxiliary', what: 'player decision: how many kegs to order (an outside input)', names: ['order decision', 'my order'], level: 'important' },
      { id: 'L1', kind: 'link', what: 'player decision (A3) informs the order rate (F1)', level: 'important' },
      { id: 'L2', kind: 'link', what: 'registered order (S3) informs the beer arrival rate (F2)', level: 'required' },
      { id: 'L3', kind: 'link', what: 'wholesaler provision capacity (A2) informs the beer arrival rate (F2): it limits what arrives, and the rest stays in S3', level: 'required' },
      { id: 'L4', kind: 'link', what: 'arrival plan (A1) informs the coming in rate (F3)', level: 'important' },
      { id: 'L5', kind: 'link', what: 'pub cellar (S1) informs the serving rate (F4): you can serve only what you have', level: 'required' },
      { id: 'L6', kind: 'link', what: 'pub customers (S5) inform the serving rate (F4)', level: 'important' },
      { id: 'L7', kind: 'link', what: 'pub customers (S5) and the serving rate (F4) inform the failed-to-serve rate (F5)', level: 'important' },
      { id: 'L8', kind: 'link', what: 'waiting to serve (S2) informs the catch up rate (F6)', level: 'required' },
      { id: 'L9', kind: 'link', what: 'pub cellar (S1) informs the catch up rate (F6)', level: 'required' },
      { id: 'L10', kind: 'link', what: 'serving rate (F4) and catch up rate (F6) inform the consumption rate (F7)', level: 'important' },
      { id: 'L11', kind: 'link', what: 'pub cellar (S1) informs the cost rate (F8): each keg in the cellar costs £0.50 a week', level: 'required' },
      { id: 'L12', kind: 'link', what: 'waiting to serve (S2) informs the cost rate (F8): each keg owed costs £1 a week', level: 'required' },
      { id: 'O1', kind: 'auxiliary', what: 'a delivery time (three weeks) informing the beer arrival rate (F2)', names: ['delivery delay', 'lead time'], level: 'optional' },
      { id: 'O2', kind: 'link', what: 'catch up rate (F6) informs the serving rate (F4): waiting customers are served first', level: 'optional' }
    ],
    variants: [
      'The registered order (S3) may be drawn as two or more stocks in a row (for example "on back order at the wholesaler" and "on the road"), with flows between them. This counts as S3, F2 and L2; the capacity limit (L3) then acts on the flow out of the first of them.',
      'Pub customers (S5) may be left out, with the coming in rate flowing straight into the backlog (S2) and one flow out of the backlog for all customers served. This counts as S5, F3, F4, F5 and F6, provided the cellar informs that outflow.',
      'The cellar may be drained by two flows, one for each kind of serving, instead of one consumption rate (F7) informed by both. This counts as F7 and L10.',
      'The two cost rates (£0.50 and £1) may be drawn as constants informing the cost rate (F8). They are welcome, not required.',
      'A learner may model the player\'s decision instead of treating it as an input, for example with links from the cellar, the backlog or the registered order into it. This is not an error and is not marked: comment on it as an extra. Leaving out a link from the registered order (S3) to such a decision is what most players of this game do, so if they model a decision without it, say so as an observation, not a fault.'
    ]
  },
  wom: null
};
if (typeof module !== 'undefined') module.exports = KEYS;
