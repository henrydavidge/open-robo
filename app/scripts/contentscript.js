import jQuery from 'jquery';
const $ = jQuery;

let tickers = [];

browser.runtime.onMessage.addListener( (msg) => {
  if (!msg || !msg.type) {
    return;
  } else if (msg.type === 'expansion-complete') {
    const unrealizedCostBasis = parseData();
    browser.storage.local.set( { unrealizedCostBasis: unrealizedCostBasis });
  } else if (msg.type === 'refresh-unrealized') {
    waitForElement('.vg-NavboxLabel', expandNavboxes);
  }
});

function parseData() {
  const tables = Array.from(document.querySelectorAll('td table.dataTable'));
  return tables.flatMap( (table, idx) => {
    const ticker = tickers[idx];
    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
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

function waitForElement(selector, fn) {
  if ($(selector).length === 0) {
    console.log('no such element, rescheduling');
    setTimeout(() => waitForElement(selector, fn), 100);
  } else {
    console.log('found element, running');
    fn();
  }
}

function expandNavboxes() {
  tickers = parseTickers();
  const elements = Array.from(document.querySelectorAll('.vg-NavboxLabel label'));
  const coordinates = elements.map( (el) => {
    const rectangle = el.getBoundingClientRect();
    return { 'x': rectangle.x, 'y': rectangle.y };
  });
  
  browser.runtime.sendMessage( { 'coordinates': coordinates });
}
