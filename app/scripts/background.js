import _ from 'lodash';

browser.runtime.onInstalled.addListener((details) => {
  console.log('previousVersion', details.previousVersion)
})

browser.tabs.onUpdated.addListener(async (tabId) => {
  browser.pageAction.show(tabId)
})

browser.runtime.onMessage.addListener(doClicks);

function spaceCalls(fn, args, delay, finalizeFn) {
  if (args.length === 0) {
    if (finalizeFn) {
      finalizeFn();
    }
    return;
  }

  fn(args[0]);
  setTimeout(() => spaceCalls(fn, args.slice(1), delay, finalizeFn), delay);
}

function doClicks(msg, sender) {
  const target = { tabId: sender.tab.id };
  chrome.debugger.attach(target, "1.2", () => {
  setTimeout(() => spaceCalls((coord) => doClick(target, coord), msg.coordinates.reverse(), 1000, () => finishExpansion(target)), 1000);
  });
}

function doClick(target, coord) {
  const cmd = { ...coord, type: "mousePressed", button: "left", clickCount: 1 };
  chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", { width: 1000, height: 10000, fitWindow: true, mobile: false, deviceScaleFactor: 1 });
  chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", cmd);
  cmd.type = "mouseReleased";
  chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", cmd);
  chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride");
}


function finishExpansion(target) {
  console.log('Finished expansion');
  chrome.debugger.detach(target);
  browser.tabs.sendMessage(target.tabId, { type: 'expansion-complete' });
}
