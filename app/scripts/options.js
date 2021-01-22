import jQuery from 'jquery';
window.$ = jQuery;

$('#save').click( () => {
  browser.storage.local.set({
    portfolio: JSON.parse($('#portfolio').val()),
    minLossToHarvest: $('#minloss').val()
  }).then(() => window.close());
});

$(document).ready( () => {
  browser.storage.local.get(['portfolio', 'minLossToHarvest'])
    .then( (contents) => {
      const sortedCategories = Object.keys(contents.portfolio)
        .sort( (k1, k2) => {
          if (contents.portfolio[k1].allocation <= contents.portfolio[k2].allocation) {
            return -1;
          } else {
            return 1;
          }
        }).reverse();
      const elementKeys = ['allocation', 'tickers'];
      $('#portfolio').val(JSON.stringify(contents.portfolio, sortedCategories.concat(elementKeys), 2));
      $('#minloss').val(contents.minLossToHarvest ? contents.minLossToHarvest : 200);
    });
});
