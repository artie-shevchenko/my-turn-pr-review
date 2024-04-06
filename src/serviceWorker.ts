import { trySync } from "./sync";
import { getReposState } from "./storage";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason == "install") {
    chrome.action.setIcon({
      path: "icons/grey128.png",
    });

    console.log("Extension successfully installed!");
  }
});

// Subscribe to an event so that Chrome runs our service worker on startup
chrome.runtime.onStartup.addListener(async () => {
  (await getReposState()).updateIcon().then(() => {
    console.log(`Service worker started`);
  });
});

// This keeps the worker alive, as recommended by
// https://developer.chrome.com/blog/longer-esw-lifetimes/
setInterval(function () {
  getReposState().then(() => {
    console.log("heart beat");
  });
}, 10000);

setInterval(function () {
  trySync();
}, 30000);
