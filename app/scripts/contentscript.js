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
    makeDataFetcher()
      .then(fetcher => fetcher.getUnrealizedCostBasis())
      .then(unrealizedCostBasis => {
        browser.storage.local.set( { unrealizedCostBasis: {
          data: unrealizedCostBasis,
          timestamp: new Date().toLocaleString('en-US')
        }});
        browser.runtime.sendMessage({ type: 'refresh-success', costBasisType: 'unrealized' });
      })
      .catch(error => {
        browser.runtime.sendMessage({ type: 'refresh-error', costBasisType: 'unrealized', msg: error});
        console.error(error);
      });
  } else if (msg.type === 'refresh-realized') {
    makeDataFetcher()
      .then(fetcher => fetcher.getRealizedCostBasis())
      .then(realizedCostBasis => {
        browser.storage.local.set( { realizedCostBasis: {
          data: realizedCostBasis,
          timestamp: new Date().toLocaleString('en-US')
        }});
        browser.runtime.sendMessage({ type: 'refresh-success', costBasisType: 'realized' });
      })
      .catch(error => {
        browser.runtime.sendMessage({ type: 'refresh-error', costBasisType: 'realized', msg: error});
        console.error(error);
      });
  } 
});

function parseDollars(text) {
  if (text === '\u2014') {
    return 0;
  }

  const replaced = text
    .replace('$', '')
    .replace(',', '')
    .replace(' ', '')
    .replace('\u2013', '-');
  return Number.parseFloat(replaced);
}

/**
 * Return a data fetch promise.
 */
function makeDataFetcher() {
  return browser.storage.local.get(['accountId'])
    .then( (contents) => {
      const accountId = contents.accountId;
      if (window.location.href.includes('personal.vanguard.com')) {
        return new VanguardFetcher();
      } else if (window.location.href.includes('client.schwab.com')) {
        return new SchwabFetcher(accountId);
      }
    });
}

class VanguardFetcher {

  getUnrealizedCostBasis() {
    if (haveRefreshedUnrealized) {
      throw 'Can only refresh cost basis once between page refreshes';
    }
    this.checkForCostBasisHeader('unrealized');
    const tickers = this.parseTickers(true);
    return this.fetchUnrealizedCostBasis()
      .then(el => {
        const costBasis = this.parseUnrealizedCostBasis(tickers, el)
        haveRefreshedUnrealized = true;
        return costBasis;
      });
  }

  getRealizedCostBasis() {
    if (haveRefreshedRealized) {
      throw 'Can only refresh cost basis once between page refreshes';
    }
    this.checkForCostBasisHeader('realized');
    const tickers = this.parseTickers(false);
    return this.fetchRealizedCostBasis().then(el => {
      const costBasis = this.parseRealizedCostBasis(tickers, el);
      haveRefreshedRealized = true;
      return costBasis;
    });
  }

  checkForCostBasisHeader(costBasisType) {
    const el = document.querySelector('div.tabbox li.current span');
    if (!el) {
      throw 'Could not find cost basis tabs. Are you on the Vanguard cost basis page?';
    }
    if (!el.textContent.trim().toLowerCase().startsWith(costBasisType)) {
      throw `The navigation tab for ${costBasisType} cost basis is not selected. ` +
        `Are you looking at the correct cost basis?`;
    }
  }

  parseUnrealizedCostBasis(tickers, el) { 
    const tables = Array.from(el.querySelectorAll('table.dataTable'));
    return tables.flatMap( (table, idx) => {
      const ticker = tickers[idx];
      const rows = Array.from(table.querySelectorAll('tr')).slice(1);
      return rows.flatMap ( (row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        return {
          ticker: ticker,
          date: Date.parse(cells[0].innerText),
          shortTermGainOrLoss: parseDollars(cells[5].innerText),
          longTermGainOrLoss: parseDollars(cells[6].innerText),
          gainOrLoss: parseDollars(cells[7].innerText),
          marketValue: parseDollars(cells[4].innerText),
        };
      });
    });
  }

  parseRealizedCostBasis(tickers, el) {
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

  parseTickers(unrealized) {
    const idPrefix = unrealized ? "unrealizedTabForm" : "realizedTabForm";
    const tables = Array.from(document.querySelectorAll("table.dataTable"))
      .filter(t => t.id.startsWith(idPrefix));
    const elements = tables.flatMap(t => Array.from(t.querySelectorAll('td.noBotBorder:not(.subHead):nth-child(1)')));
    const tickers = Array.from(elements).map( (el) => el.innerText);
    return tickers;
  }

  parseIdString(id) {
    const parts = id.split('_');
    const acctId = parts[4];
    const cusip = parts[2];
    const holdingId = parts[3];
    const randomTag = parts[5];

    return { acctId, cusip, holdingId, randomTag };
  }

  fetchUnrealizedCostBasis() {
    const idStrings = Array.from(document.querySelectorAll('span.comp-NavBox')).map(q => q.id);
    const promises = idStrings.map( id => {
      const parsedId = this.parseIdString(id);
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

  fetchRealizedCostBasis() {
    const idStrings = Array.from(document.querySelectorAll('span.comp-NavBox')).map(q => q.id)
      .filter(id => id.includes("comp-realizedTabForm"));
    const promises = idStrings.map( id => {
      const parsedId = this.parseIdString(id);
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
}

