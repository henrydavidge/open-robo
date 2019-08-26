import DataFrame from 'dataframe-js';
import { getInvestments, Private } from './invest.js';
const assert = require('assert');

function assertDfsEqual(df1, df2) {
  assert.deepEqual(df1.toCollection(), df2.toCollection());
}

describe('daysAgo', () => {
  it('basic tests', () => {
    assert(Date.now() > Private.daysAgo(1));
    assert(new Date('1970-01-01T00:00:00') < Private.daysAgo(1000));
  })
});

describe('removeIneligibleHoldings', () => {
  it('removes tickers acquired recently', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(100), ticker: 'A' },
      { date: Private.daysAgo(2), ticker: 'B' },
    ]);
    const realized = new DataFrame([ 
      { dateAcquired: Date.now(), ticker: 'A' },
    ]);
    assert(Private.removeIneligibleHoldings(realized, unrealized).count() === 0);
  });

  it('keeps tickers not acquired recently', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A' }
    ]);
    const realized = new DataFrame([
      { dateAcquired: Private.daysAgo(32), ticker: 'A' }
    ]);
    assertDfsEqual(unrealized, 
      Private.removeIneligibleHoldings(realized, unrealized));
  });
});

describe('findLossesToHarvest', () => {
  it('finds losses', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -1 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assert.equal(Private.findLossesToHarvest(realized, unrealized, 0).count(), 1);
  });

  it('ignores profits', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: 1 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assert.equal(Private.findLossesToHarvest(realized, unrealized, 0).count(), 0);
  });

  it('filters recent buys', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(1), ticker: 'A', gainOrLoss: -1 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assert.equal(Private.findLossesToHarvest(realized, unrealized, 0).count(), 0);
  });

  it('respects min loss', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -10 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assert.equal(Private.findLossesToHarvest(realized, unrealized, 0).count(), 1);
    assert.equal(Private.findLossesToHarvest(realized, unrealized, 20).count(), 0);
  });

  it('sums losses across holdings', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -5 },
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -5.01 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assertDfsEqual(Private.findLossesToHarvest(realized, unrealized, 10), unrealized);
  });

  it('only returns losses', () => {
    const unrealized = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: 10 },
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -5 }
    ]);
    const expected = new DataFrame([
      { date: Private.daysAgo(32), ticker: 'A', gainOrLoss: -5 }
    ]);
    const realized = new DataFrame([], ['ticker', 'dateAcquired']);
    assertDfsEqual(Private.findLossesToHarvest(realized, unrealized, 0), expected);
  });
});
