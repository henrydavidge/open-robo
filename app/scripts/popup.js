import DataFrame from 'dataframe-js';
import $ from 'jquery';
import dt from 'datatables.net';
import 'datatables.net-dt/css/jquery.dataTables.css';
import { getInvestments } from './invest.js';
$.DataTable = dt;

showTimestamps();
maybeDisplayTrades();
let unrealizedTable = null;
let realizedTable = null;

browser.runtime.onMessage.addListener(handleMessage);

function handleMessage(msg) {
  console.log('Received message', msg);
  if (!msg || !msg.type) {
    return;
  } else if (msg.type === 'refresh-success') {
    $(`#${msg.costBasisType}Check`).fadeIn('slow');
    $(`#${msg.costBasisType}Check`).fadeOut('slow');
    showTimestamps();
  } else if (msg.type === 'refresh-error') {
    const el = $(`#${msg.costBasisType}X`);
    el.find(".msg").text(msg.msg);
    el.fadeIn('slow');
    el.delay(5000).fadeOut('slow');
  }
}

document.getElementById('settings').onclick = () => {
  browser.runtime.openOptionsPage();
};

document.getElementById('refreshUnrealized').onclick = (event) => {
  browser.tabs.query( { active: true, currentWindow: true }).then( tabs => {
    browser.tabs.sendMessage(tabs[0].id, { type: 'refresh-unrealized' })
      .catch( err => {
        handleMessage({ 
          type: 'refresh-error', 
          costBasisType: 'unrealized', 
          msg: 'Could not communicate with content script. Are you on personal.vanguard.com?'
        });
      });
  });
};

document.getElementById('refreshRealized').onclick = (event) => {
  browser.tabs.query( { active: true, currentWindow: true }).then( tabs => {
    browser.tabs.sendMessage(tabs[0].id, { type: 'refresh-realized' })
      .catch( err => {
        console.log('In catch');
        handleMessage({ 
          type: 'refresh-error', 
          costBasisType: 'realized', 
          msg: 'Could not communicate with content script. Are you on personal.vanguard.com?'
        });
      });
  });
};

document.getElementById('invest').onclick = (event) => {
  browser.storage.local.get(['unrealizedCostBasis', 'realizedCostBasis', 'portfolio', 'minLossToHarvest'])
    .then( (obj) => {
      const realizedDf = new DataFrame(obj.realizedCostBasis.data);
      const unrealizedDf = new DataFrame(obj.unrealizedCostBasis.data);
      const cash = parseFloat(document.getElementById('cash').value);
      const trades = getInvestments(unrealizedDf, realizedDf, cash, obj.portfolio, obj.minLossToHarvest);
      saveTrades(trades);
      displayTrades(trades);
    });
};

document.getElementById('clearTrades').onclick = event => {
  clearTrades();
};

document.getElementById('toggleUnrealized').onclick = event => {
  if (unrealizedTable !== null) {
    destroyDataTable('#unrealizedTable');
    unrealizedTable = null;
    document.getElementById('toggleUnrealized').textContent = 'Show';
  } else {
    browser.storage.local.get(['unrealizedCostBasis'])
      .then( obj => {
        $('#unrealizedTable').append($('<tfoot><tr><th colspan="5" style="text-align:right"/></tr></tfoot>'));
        unrealizedTable = $('#unrealizedTable').DataTable( {
          data: obj.unrealizedCostBasis.data,
          columns: [
            { title: 'Ticker', data: 'ticker' },
            { title: 'Date', data: 'date', render: d => new Date(d).toLocaleDateString('en-US') },
            { title: 'Value', data: 'marketValue', render: formatAmount },
            { title: 'Short Term Gain/Loss', data: 'shortTermGainOrLoss', render: formatAmount },
            { title: 'Long Term Gain/Loss', data: 'longTermGainOrLoss', render: formatAmount }
          ],
          searching: false,
          paging: true,
          order: [[0, 'asc']],
          footerCallback: function(tfoot, data, start, end, display) {
            const api = this.api();
            const total = api.column(2).data().reduce( (a, b) => a + b, 0);
            $(api.column(2).footer()).html(`Total market value: ${formatAmount(total)}`);
          },
          stateSave: true
        });
        document.getElementById('toggleUnrealized').textContent = 'Hide';
      });
  }
}

document.getElementById('toggleRealized').onclick = event => {
  if (realizedTable !== null) {
    destroyDataTable('#realizedTable');
    realizedTable = null;
    document.getElementById('toggleRealized').textContent = 'Show';
  } else {
    browser.storage.local.get(['realizedCostBasis'])
      .then( obj => {
        $('#realizedTable').append($('<tfoot><tr><th colspan="4" style="text-align:right"/></tr></tfoot>'));
        realizedTable = $('#realizedTable').DataTable( {
          data: obj.realizedCostBasis.data,
          columns: [
            { title: 'Ticker', data: 'ticker' },
            { title: 'Date Acquired', data: 'dateAcquired', render: d => new Date(d).toLocaleDateString('en-US') },
            { title: 'Date Sold', data: 'dateSold', render: d => new Date(d).toLocaleDateString('en-US') },
            { title: 'Gain/Loss', data: 'gainOrLoss', render: formatAmount },
          ],
          searching: false,
          paging: true,
          order: [[0, 'asc']],
          footerCallback: function(tfoot, data, start, end, display) {
            const api = this.api();
            const total = api.column(3).data().reduce( (a, b) => a + b, 0);
            $(api.column(3).footer()).html(`Total gain/loss: ${formatAmount(total)}`);
          },
          stateSave: true
        });
        document.getElementById('toggleRealized').textContent = 'Hide';
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
  document.getElementById('investDiv').hidden = true;
  document.getElementById('clearTradesDiv').hidden = false;
  $('#buyTable').dataTable( {
    data: trades,
    columns: [ 
      { title: 'Ticker' }, 
      { title: 'Action' }, 
      { title: 'Amount', className: 'dt-right', render: formatAmount }, 
      { title: '', className: 'hide', defaultContent: 'Hide' }],
    searching: false,
    paging: false,
    order: [[1, 'desc']],
    stateSave: true
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
  return amt.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function clearTrades() {
  document.getElementById('investDiv').hidden = false;
  document.getElementById('clearTradesDiv').hidden = true;
  destroyDataTable('#sellTable');
  destroyDataTable('#buyTable');
  browser.storage.local.remove(['suggestedTrades']);
}
