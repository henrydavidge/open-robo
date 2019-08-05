import DataFrame from "dataframe-js";
import $ from 'jquery';
import dt from 'datatables.net';
import 'datatables.net-dt/css/jquery.dataTables.css';
$.DataTable = dt;

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

document.getElementById("showTrades").onclick = (event) => {
  browser.storage.local.get(['unrealizedCostBasis', 'portfolio'])
    .then( (obj) => {
      const df = new DataFrame(obj.unrealizedCostBasis.data);
      const cash = parseFloat(document.getElementById('cash').value);
      const trades = getInvestments(df, cash, obj.portfolio);
      displayTrades(trades);
    });
};

document.getElementById('clearState').onclick = event => {
  browser.storage.local.remove(['unrealizedCostBasis']);
};

showTimestamps();

function showTimestamps() {
  browser.storage.local.get(['unrealizedCostBasis'])
    .then( obj => {
      console.log(obj.unrealizedCostBasis.timestamp);
      const dateStr = obj.unrealizedCostBasis.timestamp;
      console.log(dateStr);
      document.getElementById('unrealizedLastRefresh').textContent = dateStr;
    });
}

function getInvestments(df, cash, portfolio) {
  const withCat = df.map(row => row.set('category', getCategory(row.get('ticker'), portfolio)));
  const totalValue = df.stat.sum('marketValue');
  const deltaByCat = withCat.groupBy('category').aggregate(cat => cat.stat.sum('marketValue'), 'totalValue')
    .map(row => row.set('desiredValue', portfolio[row.get('category')].allocation * (totalValue + cash)))
    .map(row => row.set('desiredDelta', Math.max(row.get('desiredValue') - row.get('totalValue'), 0)));

  const totalDelta = deltaByCat.stat.sum('desiredDelta');
  const categoriesToBuy = deltaByCat.map(row => row.set('delta', row.get('desiredDelta') * (cash / totalDelta)))
  return categoriesToBuy.map(row => row.set('ticker', chooseTicker(row.get('category'), portfolio)))
    .filter(row => row.get('delta') > 0)
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

function displayTrades(tradesDf) {
  $('#tradesTable').dataTable( {
    data: tradesDf.map(row => row.set('hide', 'Hide')).toArray(),
    columns: [ { title: 'Ticker' }, { title: 'Delta' }, { title: 'Action', className: 'hide' }],
    searching: false,
    paging: false,
    order: [[1, 'desc']]
  });
  const table = $('#tradesTable').DataTable();

  $('.hide').click( (event) => {
    const el = $(event.target).parents('tr');
    console.log(el);
    console.log(table.row(el));
    table.rows(el).remove().draw();
  });

  $('#showTrades').click(event => table.destroy());
}
