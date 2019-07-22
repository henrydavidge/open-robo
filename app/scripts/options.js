import jQuery from 'jquery';
window.$ = jQuery;

$('#save').click( () => {
  console.log($('#avkey').val());
  browser.storage.local.set({
    portfolio: JSON.parse($('#portfolio').val()),
    avkey: $('#avkey').val(),
    minloss: $('#minloss').val(),
  })
});

$(document).ready( () => {
  browser.storage.local.get(['portfolio', 'avkey', 'minloss'])
    .then( (contents) => {
      $('#portfolio').val(JSON.stringify(contents.portfolio, null, 2));
      $('#avkey').val(contents.avkey);
      $('#minloss').val(contents.minloss);
    });
});
