import DataFrame from "dataframe-js";

const BUY_ACTION = 'BUY';
const SELL_ACTION = 'SELL';
const TAX_LOSS_WINDOW_DAYS = 31;
const UNREALIZED_COLS = 
  ['ticker', 'date', 'longTermGainOrLoss', 'shortTermGainOrLoss', 'gainOrLoss', 'marketValue'];
const REALIZED_COLS = 
  ['ticker', 'dateAcquired', 'dateSold', 'gainOrLoss'];

/**
 * Determines which stocks to buy and sell.
 *
 * First, examine all holdings and see if there are any qualifying losses (those above the
 * user-defined threshold that have not been purchased in the last 30 days).
 *
 * Second, determine which categories should be bought or sold. Except to lock in losses, we only
 * make trades in the direction of current investment i.e., buy stocks if investment is positive,
 * sell if negative.
 *
 * Third, for categories that are to be purchased, chose the ticker to buy.
 *
 * Input schemas:
 * - unrealizedDf: ['ticker', 'date', 'longTermGainOrLoss', 'shortTermGainOrLoss', 'gainOrLoss', 'marketValue']
 * - realizedDf: ['ticker', 'dateAcquired', 'dateSold', 'gainOrLoss']
 */
export function getInvestments(unrealizedDf, realizedDf, cash, portfolio, minLossToHarvest) {
  Private.checkSchema(unrealizedDf, UNREALIZED_COLS);
  Private.checkSchema(realizedDf, REALIZED_COLS);
  const losses = 
    Private.findLossesToHarvest(realizedDf, unrealizedDf, minLossToHarvest, TAX_LOSS_WINDOW_DAYS);

  // For the rest of this algorithm, assume that we've already sold losses
  const cashWithLosses = cash + losses.stat.sum('marketValue');
  const unrealizedMinusLosses = unrealizedDf
    .diff(losses, ['ticker', 'date', 'marketValue', 'gainOrLoss']);
  const realizedWithLosses = realizedDf
    .union(losses.withColumn('dateSold', () => Date.now())
      .rename('date', 'dateAcquired')
      .drop('marketValue'));

  // Create an empty holding for each category so that we still calculate stats for categories that
  // don't yet have holdings
  const emptyCategoryDf = new DataFrame(Object.keys(portfolio)
    .map(cat => [cat]), ['category']).withColumn('marketValue', () => 0);

  // Annotate each holding by the category to which it belongs
  const withCat = unrealizedMinusLosses
    .map(row => row.set('category', Private.getCategory(row.get('ticker'), portfolio)))
    .select('category', 'marketValue')
    .union(emptyCategoryDf);

  // Determine how much the allocation of each category should change
  const floorFn = n => cashWithLosses > 0 ? Math.max(n, 0) : Math.min(n, 0);
  const totalValue = unrealizedMinusLosses.stat.sum('marketValue');
  const deltaByCat = withCat.groupBy('category').aggregate(cat => cat.stat.sum('marketValue'), 'totalValue')
    .map(row => row.set('desiredValue', portfolio[row.get('category')].allocation * (totalValue + cashWithLosses)))
    .map(row => row.set('desiredDelta', floorFn(row.get('desiredValue') - row.get('totalValue'))));

  // Normalize by the total amount of investment
  const totalDelta = deltaByCat.stat.sum('desiredDelta');
  const normalizedDeltaByCat = deltaByCat
    .map(row => row.set('delta', row.get('desiredDelta') * (cashWithLosses / totalDelta)))
    .select('category', 'delta');

  const categoriesToBuy = normalizedDeltaByCat.filter(r => r.get('delta') > 0);
  const categoriesToSell = normalizedDeltaByCat.filter(r => r.get('delta') < 0);

  // Get dataframes with display schema (ticker, action, amount)
  const lossesToSell = losses.distinct('ticker')
    .withColumn('action', () => SELL_ACTION)
    .withColumn('amount', () => 'LOSSES')
    .select('ticker', 'action', 'amount');
  const toBuy = Private.chooseTickersToBuy(categoriesToBuy, portfolio, unrealizedDf, realizedDf, minLossToHarvest)
    .withColumn('action', () => BUY_ACTION)
    .rename('delta', 'amount')
    .select('ticker', 'action', 'amount');
  const toSell = Private.chooseHoldingsToSell(categoriesToSell, unrealizedMinusLosses, portfolio)
    .withColumn('action', () => SELL_ACTION)
    .rename('delta', 'amount')
    .select('ticker', 'action', 'amount');
      

  return lossesToSell.union(toBuy).union(toSell).toArray();
}

export class Private {

  static daysAgo(days) {
    return Date.now() - 1000 * 60 * 60 * 24 * days;
  }

  /**
   * Filters out current holdings (as defined by `unrealizedDf`) that are not eligible for tax loss
   * harvesting because their ticker has been purchased within the tax loss harvesting window.
   */
  static removeIneligibleHoldings(realizedDf, unrealizedDf, activityWindow) {
    this.checkSchema(realizedDf, ['ticker', 'dateAcquired']);
    this.checkSchema(unrealizedDf, ['ticker', 'date']);
    const recentTransactions = 
      unrealizedDf.filter(row => row.get('date') > this.daysAgo(activityWindow)).select('ticker')
      .union(realizedDf.filter(row => row.get('dateAcquired') > this.daysAgo(activityWindow)).select('ticker'));
    return unrealizedDf.diff(recentTransactions, 'ticker');
  }

  /**
   * Chooses which holdings should be sold to realize a loss (short or long term).
   *
   * Tickers are selected if:
   * - They are eligible for tax loss harvesting
   * - Their total loss is greater than the user-provided threshold for tax loss harvesting
   *
   * All holdings for selected tickers are returned.
   */
  static findLossesToHarvest(realizedDf, unrealizedDf, minLossToHarvest, activityWindow) {
    this.checkSchema(realizedDf, ['ticker', 'dateAcquired']);
    this.checkSchema(unrealizedDf, ['ticker', 'date', 'gainOrLoss']);
    const eligibleHoldings = this.removeIneligibleHoldings(realizedDf, unrealizedDf, activityWindow);

    const tickersToHarvest = this.addTotalLoss(eligibleHoldings)
      .filter(r => r.get('totalLoss') <= -minLossToHarvest);

    const lossesToHarvest = eligibleHoldings.filter(row => row.get('gainOrLoss') < 0)
      .leftJoin(tickersToHarvest, 'ticker')
      .filter(r => r.get('totalLoss'))
      .drop('totalLoss');
    return lossesToHarvest;
  }

  static addTotalLoss(df, threshold) {
    this.checkSchema(df, ['ticker', 'gainOrLoss']);
    return df
      .withColumn('loss', r => Math.min(r.get('gainOrLoss'), 0))
      .groupBy('ticker')
      .aggregate(g => g.stat.sum('loss'))
      .rename('aggregation', 'totalLoss');
  }

  static getCategory(ticker, portfolio) {
    let category = null;
    Object.keys(portfolio).forEach( (cat) => {
      if (portfolio[cat].tickers.includes(ticker)) {
        category = cat;
      }
    });
    return category;
  }

  /**
   * Choose the ticker to buy for each category. For each category, choose the ticker appearing first
   * in the portfolio's list of tickers that has not been sold for a loss in the last 30 days (to
   * avoid the wash sale rule). Tickers that are currently held at a loss but not yet eligible for
   * tax lost harvesting are also avoided.
   */
  static chooseTickersToBuy(categoriesToBuy, portfolio, unrealizedDf, realizedDf, minLossToHarvest) {
    this.checkSchema(categoriesToBuy, ['category', 'delta']);
    this.checkSchema(realizedDf, REALIZED_COLS);
    const recentLosses = this.addTotalLoss(realizedDf
      .filter(r => r.get('dateSold') > this.daysAgo(TAX_LOSS_WINDOW_DAYS)))
      .select('ticker', 'totalLoss')
      .withColumn('priority', () => 0);
    const potentialLosses = this.addTotalLoss(unrealizedDf)
      .map(r => r.get('totalLoss') <= -minLossToHarvest ? r : r.set('totalLoss', 0))
      .select('ticker', 'totalLoss')
      .withColumn('priority', () => 1);
    const allLosses = recentLosses.union(potentialLosses)
      .filter(r => r.get('totalLoss') < 0)
      .sortBy(['priority', 'totalLoss'], true);
    const tickersToBuy = categoriesToBuy.map( row => {
      const category = row.get('category');
      const tickers = portfolio[category].tickers;
      const lossesForCategory = allLosses.filter(r => tickers.includes(r.get('ticker')));
      const firstLosslessTicker = tickers
        .find(el => !allLosses.find(row => row.get('ticker') === el))

      // If there's no eligible ticker, just buy the first one
      const ticker = 
        firstLosslessTicker ? firstLosslessTicker : lossesForCategory.toArray('ticker')[0];
      return row.set('ticker', ticker);
    }).select('ticker', 'delta');
    return tickersToBuy;
  }

  /**
   * Choose the holdings to sell for each category.
   *
   * Prefers long term holdings
   *
   * Returns a list of shares to sell
   */
  static chooseHoldingsToSell(categoriesToSell, unrealizedMinusLosses, portfolio) {
    this.checkSchema(unrealizedMinusLosses, UNREALIZED_COLS);
    this.checkSchema(categoriesToSell, ['category', 'delta']);

    const withHoldingType = unrealizedMinusLosses
      .withColumn('preference', r => {
        if (r.get('shortTermGainOrLoss') !== 0) {
          return 0;
        } else {
          return 1;
        }
      });

    let tickersToSell = [];
    categoriesToSell.map( row => {
      const tickers = portfolio[row.get('category')].tickers;
      const allForCategory = withHoldingType.filter(r => tickers.includes(r.get('ticker')));
      const grouped = allForCategory.groupBy('ticker', 'preference')
        .aggregate(g => g.stat.sum('marketValue'))
        .sortBy('preference');
      let totalToSell = -row.get('delta');
      grouped.toCollection().forEach( ticker => {
        const toSell = Math.min(ticker.aggregation, totalToSell);
        totalToSell -= toSell;
        if (toSell > 0) {
          tickersToSell.push({ ticker: ticker.ticker, delta: toSell });
        }
      });
    });

    return new DataFrame(tickersToSell)
      .groupBy('ticker')
      .aggregate(g => g.stat.sum('delta'))
      .rename('aggregation', 'delta');
  }

  static checkSchema(df, cols) {
    const schema = df.listColumns();
    const missingCols = cols.filter(c => !schema.includes(c));
    if (missingCols.length > 0) {
      throw "DF was missing columns " + JSON.stringify(missingCols); 
    }
  }
}
