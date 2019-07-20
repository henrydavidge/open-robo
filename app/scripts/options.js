import jQuery from 'jquery';
window.$ = jQuery;

$('#save').click( () => {
  console.log($('#avkey').val());
  browser.storage.local.set({
    portfolio: $('#portfolio').val(),
    avkey: $('#avkey').val(),
    cashfrac: $('#cashfrac').val(),
    minloss: $('#minloss').val(),
  })
});

$(document).ready( () => {
  browser.storage.local.get(['portfolio', 'avkey', 'cashfrac', 'minloss'])
    .then( (contents) => {
      console.warn(contents);
      console.log(contents);
      $('#portfolio').val(contents.portfolio);
      $('#avkey').val(contents.avkey);
      $('#cashfrac').val(contents.cashfrac);
      $('#minloss').val(contents.minloss);
    });
});
