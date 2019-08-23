import DataFrame from "dataframe-js";
import $ from 'jquery';
import dt from 'datatables.net';
import 'datatables.net-dt/css/jquery.dataTables.css';
$.DataTable = dt;

showTimestamps();
maybeDisplayTrades();
let unrealizedTable = null;
let realizedTable = null;

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
      /**
      const unrealizedMinusLosses = unrealizedDf
        .diff(losses, ['ticker', 'date', 'marketValue', 'gainOrLoss']);
      */
      const trades = getInvestments(unrealizedDf, realizedDf, cash, obj.portfolio)
        .map(row => row.set('hide', 'Hide'));
      saveTrades(trades.toArray());
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
            { title: "Gain/Loss", data: "gainOrLoss" }
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
  const cashWithLosses = cash - losses.stat.sum('gainOrLoss');
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
  const withCat = unrealizedDf.map(row => row.set('category', getCategory(row.get('ticker'), portfolio)))
    .select('category', 'marketValue')
    .union(emptyCategoryDf);

  // Determine how much the allocation of each category should change
  const floorFn = n => cash > 0 ? Math.max(n, 0) : Math.min(n, 0);
  const totalValue = unrealizedDf.stat.sum('marketValue');
  const deltaByCat = withCat.groupBy('category').aggregate(cat => cat.stat.sum('marketValue'), 'totalValue')
    .map(row => row.set('desiredValue', portfolio[row.get('category')].allocation * (totalValue + cash)))
    .map(row => row.set('desiredDelta', floorFn(row.get('desiredValue') - row.get('totalValue'))));

  // Normalize by the total amount of investment
  const totalDelta = deltaByCat.stat.sum('desiredDelta');
  const normalizedDeltaByCat = deltaByCat
    .map(row => row.set('delta', row.get('desiredDelta') * (cash / totalDelta)))
    .select('category', 'delta');

  console.log('normalizedDelta', normalizedDeltaByCat.toArray());
  const categoriesToBuy = normalizedDeltaByCat.filter(r => r.get('delta') > 0);
  const categoriesToSell = normalizedDeltaByCat.filter(r => r.get('delta') < 0);
  const recentLosses = realizedDf.filter(row => row.get('dateSold') > daysAgo(30));

  return {
    toBuy: chooseTickersToBuy(categoriesToBuy, portfolio, recentLosses),
    toSell: chooseHoldingsToSell(losses, categoriesToSell, unrealizedMinusLosses, portfolio)
  };
}

function daysAgo(days) {
  return Date.now() - 1000 * 60 * 60 * 24 * 30;
}

function removeRecentTransactions(realizedDf, unrealizedDf) {
  console.log(daysAgo(30));
  const recentTransactions = 
    unrealizedDf.filter(row => row.get('date') > daysAgo(30)).select('ticker')
      .union(realizedDf.filter(row => row.get('dateAcquired') > daysAgo(30)).select('ticker'));
  console.log('recentTransactions', recentTransactions.toArray());
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
 */
function chooseHoldingsToSell(losses, unrealizedMinusLosses, categoriesToSell, portolio) {

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

function displayTrades(tradesDf) {
  console.log("Making trades table");
  document.getElementById("investDiv").hidden = true;
  document.getElementById("clearTradesDiv").hidden = false;
  $('#tradesTable').dataTable( {
    data: tradesDf.toArray(),
    columns: [ 
      { title: 'Ticker' }, 
      { title: '$' }, 
      { title: 'Action', className: 'hide' }],
    searching: false,
    paging: false,
    order: [[1, 'desc']]
  });
  const table = $('#tradesTable').DataTable();

  $('.hide').click( (event) => {
    const el = $(event.target).parents('tr');
    table.rows(el).remove().draw();
    saveTrades(table.rows().data().toArray());
  });
}

function clearTrades() {
  document.getElementById("investDiv").hidden = false;
  document.getElementById("clearTradesDiv").hidden = true;
  destroyDataTable("#sellTable");
  destroyDataTable("#buyTable");
  browser.storage.local.remove(['suggestedTrades']);
}
