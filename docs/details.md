---
layout: default
title: Algorithm details
nav_order: 3
---

The [Open Robo source
code](https://github.com/henrydavidge/open-robo/blob/master/app/scripts/invest.js) is ultimately the
best documentation for its investing algorithm. Major design decisions are documented below.

- To reduce user overhead and avoid incurring capital gains, rebalancing is performed only through
  deposits and withdrawals. For best operation, you should aim to regularly deposit money into your
  portfolio. Monthly or quarterly deposit goals are useful planning tools.
- When choosing which ETF to buy for a given category, Open Robo selects the first ETF for that
  category that does not have a current loss greater than the minimum tax loss harvesting threshold.
  ETFs with potential losses are avoided even if the loss cannot yet be realized without triggering
  a wash sale.
- When choosing which ETFs to sell for a given category, long term holdings are preferred to short
  term holdings.
- If you have questions about the investment algorithm that you feel should be documented here,
  please submit a GitHub [issue](https://github.com/henrydavidge/open-robo/issues) or (even better!)
  a [pull request](https://github.com/henrydavidge/open-robo/pulls).
