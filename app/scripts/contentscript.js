import jQuery from 'jquery';
const $ = jQuery;

let haveRefreshedUnrealized = false;
let haveRefreshedRealized = false;

browser.runtime.onMessage.addListener( (msg) => {
  console.log('Received message', msg);
  if (!msg || !msg.type) {
    return;
  } else if (msg.type === 'expansion-complete') {
    const unrealizedCostBasis = parseUnrealizedCostBasis();
    browser.storage.local.set( { unrealizedCostBasis: unrealizedCostBasis });
  } else if (msg.type === 'refresh-unrealized') {
    try {
      if (haveRefreshedUnrealized) {
        throw 'Can only refresh cost basis once between page refreshes';
      }
      const tickers = parseTickers(true);
      fetchUnrealizedCostBasis().then(el => {
        const unrealizedCostBasis = parseUnrealizedCostBasis(tickers, el);
        browser.storage.local.set( { unrealizedCostBasis: {
          data: unrealizedCostBasis,
          timestamp: new Date().toLocaleString('en-US')
        }});
        browser.runtime.sendMessage({ type: 'unrealized-success' });
        haveRefreshedUnrealized = true;
      });
    } catch(error) {
      browser.runtime.sendMessage({ type: 'unrealized-error', msg: error});
      console.error(error);
    }
  } else if (msg.type === 'refresh-realized') {
    try {
      if (haveRefreshedRealized) {
        throw 'Can only refresh cost basis once between page refreshes';
      }
      const tickers = parseTickers(false);
      fetchRealizedCostBasis().then(el => {
        const realizedCostBasis = parseRealizedCostBasis(tickers, el);
        browser.storage.local.set( { realizedCostBasis: {
          data: realizedCostBasis,
          timestamp: new Date().toLocaleString('en-US')
        }});
        browser.runtime.sendMessage({ type: 'realized-success' });
        haveRefreshedRealized = true;
      });
    } catch(error) {
      browser.runtime.sendMessage({ type: 'realized-error', msg: error});
      console.error(error);
    }
  }
});

function parseDollars(text) {
  const replaced = text
    .replace('$', '')
    .replace(',', '')
    .replace(' ', '')
    .replace('\u2013', '-');
  return Number.parseFloat(replaced);
}

function parseUnrealizedCostBasis(tickers, el) { 
  const tables = Array.from(el.querySelectorAll('table.dataTable'));
  return tables.flatMap( (table, idx) => {
    const ticker = tickers[idx];
    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
    return rows.flatMap ( (row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      return {
        ticker: ticker,
        date: Date.parse(cells[0].innerText),
        gainOrLoss: parseDollars(cells[7].innerText),
        marketValue: parseDollars(cells[4].innerText)
      };
    });
  });
}

function parseRealizedCostBasis(tickers, el) {
  const tables = Array.from(el.querySelectorAll('table.dataTable'))
    .filter(t => t.id.includes("noValue"));
  return tables.flatMap( (table, idx) => {
    const ticker = tickers[idx];
    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
    const rowData =  rows.flatMap ( (row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      return {
        ticker: ticker,
        dateSold: Date.parse(cells[0].innerText),
        dateAcquired: Date.parse(cells[1].innerText),
        gainOrLoss: parseDollars(cells[9].innerText)
      };
    });
    return rowData;
  });
}

function parseTickers(unrealized) {
  const idPrefix = unrealized ? "unrealizedTabForm" : "realizedTabForm";
  const tables = Array.from(document.querySelectorAll("table.dataTable"))
    .filter(t => t.id.startsWith(idPrefix));
  const elements = tables.flatMap(t => Array.from(t.querySelectorAll('td.noBotBorder:not(.subHead):nth-child(1)')));
  const tickers = Array.from(elements).map( (el) => el.innerText);
  return tickers;
}

function parseIdString(id) {
  const parts = id.split('_');
  const acctId = parts[4];
  const cusip = parts[2];
  const holdingId = parts[3];
  const randomTag = parts[5];

  return { acctId, cusip, holdingId, randomTag };
}

function fetchUnrealizedCostBasis() {
  const idStrings = Array.from(document.querySelectorAll('span.comp-NavBox')).map(q => q.id);
  const promises = idStrings.map( id => {
    const parsedId = parseIdString(id);
    const url = `https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/subview/lotdata.xhtml?cusip=${parsedId.cusip}&acctId=${parsedId.acctId}&holdingID=${parsedId.holdingId}&isMF=false&isShort=false&randomTag=${parsedId.randomTag}`;
    return fetch(url, 
      {
        "credentials": "include",
        "headers": { 
          "accept":"*/*",
          "accept-language":"en-US,en;q=0.9",
          "adrum":"isAjax:true",
          "cache-control":"no-cache",
          "pragma":"no-cache"
        },
        "referrer":"https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/CostBasisSummary.xhtml",
        "referrerPolicy":"no-referrer-when-downgrade",
        "body":null,
        "method":"GET",
        "mode":"cors"
      })
      .then(r => r.text())
      .catch(error => console.log(error));
  });
  return Promise.all(promises)
    .then(strings => new DOMParser().parseFromString(strings.join(''), 'text/html'));
}

function fetchRealizedCostBasis() {
  const idStrings = Array.from(document.querySelectorAll('span.comp-NavBox')).map(q => q.id)
    .filter(id => id.includes("comp-realizedTabForm"));
  const promises = idStrings.map( id => {
    const parsedId = parseIdString(id);
    const url = `https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/subview/lotdata.xhtml?cusip=${parsedId.cusip}&acctId=${parsedId.acctId}&holdingID=${parsedId.holdingId}&isMF=false&isShort=false&randomTag=${parsedId.randomTag}`;
    return fetch(url, 
      {
        "credentials": "include",
        "headers": { 
          "accept":"*/*",
          "accept-language":"en-US,en;q=0.9",
          "adrum":"isAjax:true",
          "cache-control":"no-cache",
          "pragma":"no-cache"
        },
        "referrer":"https://personal.vanguard.com/us/XHTML/com/vanguard/costbasisnew/xhtml/CostBasisSummary.xhtml",
        "referrerPolicy":"no-referrer-when-downgrade",
        "body":null,
        "method":"GET",
        "mode":"cors"
      })
      .then(r => r.text())
      .catch(error => console.log(error));
  });
  return Promise.all(promises)
    .then(strings => new DOMParser().parseFromString(strings.join(''), 'text/html'));
}
