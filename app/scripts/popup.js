import DataFrame from "dataframe-js";
import $ from 'jquery';
import dt from 'datatables.net';
import 'datatables.net-dt/css/jquery.dataTables.css';
$.DataTable = dt;

showTimestamps();
maybeDisplayTrades();
let unrealizedTable = null;

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

document.getElementById("invest").onclick = (event) => {
  browser.storage.local.get(['unrealizedCostBasis', 'portfolio'])
    .then( (obj) => {
      const df = new DataFrame(obj.unrealizedCostBasis.data);
      const cash = parseFloat(document.getElementById('cash').value);
      const trades = getInvestments(df, cash, obj.portfolio)
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
            { title: "Value", data: "marketValue" },
            { title: "Date", data: "date", render: d => new Date(d).toLocaleDateString("en-US") },
          ],
          searching: false,
          paging: false,
          order: [[0, 'asc']]
        });
        document.getElementById("toggleUnrealized").textContent = "Hide";
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
}

function getInvestments(df, cash, portfolio) {
  const floorFn = n => cash > 0 ? Math.max(n, 0) : Math.min(n, 0);
  const withCat = df.map(row => row.set('category', getCategory(row.get('ticker'), portfolio)));
  const totalValue = df.stat.sum('marketValue');
  const deltaByCat = withCat.groupBy('category').aggregate(cat => cat.stat.sum('marketValue'), 'totalValue')
    .map(row => row.set('desiredValue', portfolio[row.get('category')].allocation * (totalValue + cash)))
    .map(row => row.set('desiredDelta', floorFn(row.get('desiredValue') - row.get('totalValue'))));

  const totalDelta = deltaByCat.stat.sum('desiredDelta');
  const categoriesToBuy = deltaByCat.map(row => row.set('delta', row.get('desiredDelta') * (cash / totalDelta)))
    .filter(row => row.get('delta') != 0);
  return categoriesToBuy.map(row => row.set('ticker', chooseTicker(row.get('category'), portfolio)))
    .select('ticker', 'delta');
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

function chooseTicker(category, portfolio) {
  return portfolio[category].tickers[0];
}

function maybeDisplayTrades() {
  browser.storage.local.get(['suggestedTrades'])
    .then( obj => {
      if (obj.suggestedTrades) {
        console.log(obj.suggestedTrades);
        displayTrades(new DataFrame(obj.suggestedTrades));
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
      { title: 'Delta' }, 
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
  destroyDataTable("#tradesTable");
  browser.storage.local.remove(['suggestedTrades']);
}
