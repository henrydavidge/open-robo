import DataFrame from "dataframe-js";
import $ from 'jquery';
import dt from 'datatables.net';
import 'datatables.net-dt/css/jquery.dataTables.css';
$.DataTable = dt;

showTimestamps();
maybeDisplayTrades();
let unrealizedTable = null;
let realizedTable = null;
const BUY_ACTION = 'BUY';
const SELL_ACTION = 'SELL';

browser.runtime.onMessage.addListener( (msg) => {
  console.log('Received message', msg);
  if (!msg || !msg.type) {
    return;
  } else if (msg.type === 'unrealized-success') {
    $('#unrealizedCheck').fadeIn('slow');
    $('#unrealizedCheck').fadeOut('slow');
    showTimestamps();
  } else if (msg.type === 'unrealized-error') {
    $('#unrealizedX').fadeIn('slow');
    $('#unrealizedX').fadeOut('slow');
  }
});

document.getElementById("refreshUnrealized").onclick = (event) => {
  console.log('Got click, sending message');
  chrome.tabs.query( { active: true, currentWindow: true }, (tabs) => {
    browser.tabs.sendMessage(tabs[0].id, { type: 'refresh-unrealized' })
  });
};

document.getElementById("refreshRealized").onclick = (event) => {
  console.log('Got click, sending message');
  chrome.tabs.query( { active: true, currentWindow: true }, (tabs) => {
    browser.tabs.sendMessage(tabs[0].id, { type: 'refresh-realized' })
  });
};

document.getElementById("invest").onclick = (event) => {
  browser.storage.local.get(['unrealizedCostBasis', 'realizedCostBasis', 'portfolio'])
    .then( (obj) => {
      const realizedDf = new DataFrame(obj.realizedCostBasis.data);
      const unrealizedDf = new DataFrame(obj.unrealizedCostBasis.data);
      const cash = parseFloat(document.getElementById('cash').value);
      const trades = getInvestments(unrealizedDf, realizedDf, cash, obj.portfolio);
      saveTrades(trades);
      displayTrades(trades);
    });
};

document.getElementById("clearTrades").onclick = event => {
  clearTrades();
};

document.getElementById("toggleUnrealized").onclick = event => {
  if (unrealizedTable !== null) {
    destroyDataTable("#unrealizedTable");
    unrealizedTable = null;
    document.getElementById("toggleUnrealized").textContent = "Show";
  } else {
    browser.storage.local.get(['unrealizedCostBasis'])
      .then( obj => {
        unrealizedTable = $('#unrealizedTable').DataTable( {
          data: obj.unrealizedCostBasis.data,
          columns: [
            { title: "Ticker", data: "ticker" },
            { title: "Date", data: "date", render: d => new Date(d).toLocaleDateString("en-US") },
            { title: "Value", data: "marketValue" },
            { title: "Short Term Gain/Loss", data: "shortTermGainOrLoss" },
            { title: "Long Term Gain/Loss", data: "longTermGainOrLoss" }
          ],
          searching: false,
          paging: false,
          order: [[0, 'asc']]
        });
        document.getElementById("toggleUnrealized").textContent = "Hide";
      });
  }
}

document.getElementById("toggleRealized").onclick = event => {
  if (realizedTable !== null) {
    destroyDataTable("#realizedTable");
    realizedTable = null;
    document.getElementById("toggleRealized").textContent = "Show";
  } else {
    browser.storage.local.get(['realizedCostBasis'])
      .then( obj => {
        realizedTable = $('#realizedTable').DataTable( {
          data: obj.realizedCostBasis.data,
          columns: [
            { title: "Ticker", data: "ticker" },
            { title: "Date Acquired", data: "dateAcquired", render: d => new Date(d).toLocaleDateString("en-US") },
            { title: "Date Sold", data: "dateSold", render: d => new Date(d).toLocaleDateString("en-US") },
            { title: "Gain/Loss", data: "gainOrLoss" },
          ],
          searching: false,
          paging: false,
          order: [[0, 'asc']]
        });
        document.getElementById("toggleRealized").textContent = "Hide";
      });
  }
}

function saveTrades(data) {
  browser.storage.local.set({ suggestedTrades: data });
}

function destroyDataTable(selector) {
  if ($(selector).children().length === 0) {
    return;
  }

  $(selector).DataTable().destroy();
  $(selector).empty();
}

function showTimestamps() {
  browser.storage.local.get(['unrealizedCostBasis'])
    .then( obj => {
      const dateStr = obj.unrealizedCostBasis.timestamp;
      document.getElementById('unrealizedLastRefresh').textContent = dateStr;
    });

  browser.storage.local.get(['realizedCostBasis'])
    .then( obj => {
      const dateStr = obj.realizedCostBasis.timestamp;
      document.getElementById('realizedLastRefresh').textContent = dateStr;
    });
}

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
 */
function getInvestments(unrealizedDf, realizedDf, cash, portfolio) {
  const losses = findLossesToHarvest(realizedDf, unrealizedDf);

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
    .map(row => row.set('category', getCategory(row.get('ticker'), portfolio)))
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
  console.log('categoriesToBuy', categoriesToBuy.toCollection());
  const categoriesToSell = normalizedDeltaByCat.filter(r => r.get('delta') < 0);
  const recentLosses = realizedWithLosses.filter(row => row.get('dateSold') > daysAgo(10));

  // Get dataframes with display schema (ticker, action, amount)
  const lossesToSell = losses.distinct('ticker')
    .withColumn('action', () => SELL_ACTION)
    .withColumn('amount', () => 'LOSSES')
    .select('ticker', 'action', 'amount');
  const toBuy = chooseTickersToBuy(categoriesToBuy, portfolio, recentLosses)
    .withColumn('action', () => BUY_ACTION)
    .rename('delta', 'amount')
    .select('ticker', 'action', 'amount');
  const toSell = chooseHoldingsToSell(categoriesToSell, unrealizedMinusLosses, portfolio)
    .withColumn('action', () => SELL_ACTION)
    .rename('delta', 'amount')
    .select('ticker', 'action', 'amount');
      

  return lossesToSell.union(toBuy).union(toSell).toArray();
}

function daysAgo(days) {
  return Date.now() - 1000 * 60 * 60 * 24;
}

function removeRecentTransactions(realizedDf, unrealizedDf) {
  const recentTransactions = 
    unrealizedDf.filter(row => row.get('date') > daysAgo(1)).select('ticker')
      .union(realizedDf.filter(row => row.get('dateAcquired') > daysAgo(1)).select('ticker'));
  return unrealizedDf.diff(recentTransactions, 'ticker');
}

function findLossesToHarvest(realizedDf, unrealizedDf) {
  const eligibleHoldings = removeRecentTransactions(realizedDf, unrealizedDf);
    
  console.log('eligibleHoldings', eligibleHoldings);
  const tickersToHarvest = eligibleHoldings
    .filter(row => row.get('gainOrLoss') < -200)
    .distinct('ticker');
  return eligibleHoldings.filter(row => row.get('gainOrLoss') < 0)
    .leftJoin(tickersToHarvest, 'ticker');
}

function getCategory(ticker, portfolio) {
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
 * avoid the wash sale rule).
 *
 * TODO(hhd): We should be smarter here choose holdings that we bought most recently
 */
function chooseTickersToBuy(categoriesToBuy, portfolio, recentLosses) {
  const tickersToBuy = categoriesToBuy.map( row => {
    const category = row.get('category');
    const firstEligibleTicker = portfolio[category].tickers
      .find(el => !recentLosses.find(row => row.get('ticker') === el))

    // If there's no eligible ticker, just buy the first one
    const ticker = firstEligibleTicker ? firstEligibleTicker : portfolio[category].tickers[0];
    return row.set('ticker', ticker);
  }).select('ticker', 'delta');
  return tickersToBuy;
}

/**
 * Choose the holdings to sell for each category.
 *
 * Prefers holdings which
 * 1) are long term capital gains
 * 2) are already being sold as part of the losses
 * 3) appear first in the list of tickers for the category
 *
 * Returns a list of shares to sell
 */
function chooseHoldingsToSell(categoriesToSell, unrealizedMinusLosses, portfolio) {
  console.log('unrealizedMinusLosses', unrealizedMinusLosses.toCollection());
  console.log('categoriesToSell', categoriesToSell.toCollection());

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
  const output = new DataFrame(tickersToSell)
  console.log('output', output.toCollection());
  return output;
}

function maybeDisplayTrades() {
  browser.storage.local.get(['suggestedTrades'])
    .then( obj => {
      if (obj.suggestedTrades) {
        displayTrades(obj.suggestedTrades);
      } else {
        clearTrades();
      }
    });
}

function displayTrades(trades) {
  console.log("Making trades table", trades);
  document.getElementById("investDiv").hidden = true;
  document.getElementById("clearTradesDiv").hidden = false;
  $('#buyTable').dataTable( {
    data: trades,
    columns: [ 
      { title: 'Ticker' }, 
      { title: 'Action' }, 
      { title: 'Amount', render: formatAmount }, 
      { title: '', className: 'hide', defaultContent: 'Hide' }],
    searching: false,
    paging: false,
    order: [[1, 'desc']]
  });
  const table = $('#buyTable').DataTable();

  $('.hide').click( (event) => {
    const el = $(event.target).parents('tr');
    table.rows(el).remove().draw();
    saveTrades(table.rows().data().toArray());
  });
}

function formatAmount(amt) {
  if (typeof amt !== 'number') {
    return amt;
  }

  return '$' + amt.toFixed(2);
}

function clearTrades() {
  document.getElementById("investDiv").hidden = false;
  document.getElementById("clearTradesDiv").hidden = true;
  destroyDataTable("#sellTable");
  destroyDataTable("#buyTable");
  browser.storage.local.remove(['suggestedTrades']);
}
