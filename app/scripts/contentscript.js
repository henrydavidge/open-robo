import jQuery from 'jquery';
const $ = jQuery;

let haveRefreshed = false;

browser.runtime.onMessage.addListener( (msg) => {
  console.log('Received message', msg);
  if (!msg || !msg.type) {
    return;
  } else if (msg.type === 'expansion-complete') {
    const unrealizedCostBasis = parseData();
    browser.storage.local.set( { unrealizedCostBasis: unrealizedCostBasis });
  } else if (msg.type === 'refresh-unrealized') {
    try {
      if (haveRefreshed) {
        throw 'Can only refresh cost basis once between page refreshes';
      }
      const tickers = parseTickers();
      fetchTickerData().then(el => {
        const unrealizedCostBasis = parseData(tickers, el);
        console.log('New cost basis is', unrealizedCostBasis);
        browser.storage.local.set( { unrealizedCostBasis: {
          data: unrealizedCostBasis,
          timestamp: new Date().toLocaleString('en-US')
        }});
        browser.runtime.sendMessage({ type: 'unrealized-success' });
        haveRefreshed = true;
      });
    } catch(error) {
      browser.runtime.sendMessage({ type: 'unrealized-error', msg: error});
      console.error(error);
    }
  }
});

function parseData(tickers, el) { 
  const tables = Array.from(el.querySelectorAll('table.dataTable'));
  return tables.flatMap( (table, idx) => {
    const ticker = tickers[idx];
    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
    console.log('Number of rows', rows.length);
    return rows.flatMap ( (row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      return {
        ticker: ticker,
        date: Date.parse(cells[0].innerText),
        marketValue: Number.parseFloat(cells[4].innerText.replace('$', '').replace(',', ''))
      };
    });
  });
}

function parseTickers() {
  const elements = document.querySelectorAll('table.dataTable td.noBotBorder:not(.subHead):nth-child(1)');
  const tickers = Array.from(elements).map( (el) => el.innerText);
  return tickers;
}

function fetchTickerData() {
  const idStrings = Array.from(document.querySelectorAll('span.comp-NavBox')).map(q => q.id);
  const promises = idStrings.map( id => {
    const parts = id.split('_');
    const acctId = parts[4];
    const cusip = parts[2];
    const holdingId = parts[3];
    const randomTag = parts[5];
    const url = `https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/subview/lotdata.xhtml?cusip=${cusip}&acctId=${acctId}&holdingID=${holdingId}&isMF=false&isShort=false&randomTag=${randomTag}`;
    return fetch(url, 
      {
        "credentials": "include",
        "headers": { 
          "accept":"*/*",
          "accept-language":"en-US,en;q=0.9","adrum":"isAjax:true","cache-control":"no-cache","pragma":"no-cache"},"referrer":"https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/CostBasisSummary.xhtml","referrerPolicy":"no-referrer-when-downgrade","body":null,"method":"GET","mode":"cors"})
      .then(r => r.text())
      .catch(error => console.log(error));
  });
  return Promise.all(promises)
    .then(strings => new DOMParser().parseFromString(strings.join(''), 'text/html'));
}
