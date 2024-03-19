import { Octokit } from "@octokit/rest";
import { GitHubUser } from "./gitHubUser";
import { sync } from "./github";
import { getGitHubUser, getReposState } from "./storage";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason == "install") {
    chrome.action.setIcon({
      path: "icons/grey128.png",
    });

    console.log("Extension successfully installed!");
  }
});

// Subscribe to an event so that Chrome runs our service worker on startup
chrome.runtime.onStartup.addListener(() => {
  console.log(`Service worker started`);
});

export let octokit: Octokit;

// This keeps the worker alive, as recommended by
// https://developer.chrome.com/blog/longer-esw-lifetimes/
setInterval(function () {
  getReposState().then(() => {
    console.log("heart beat");
  });
}, 10000);

setInterval(function () {
  getGitHubUser()
    .then((gitHubUser) => {
      syncWithGitHub(gitHubUser);
    })
    .catch((e) => {
      console.error("Sync failed", e);
    });
}, 20000);

let syncInProgress = false;

export async function syncWithGitHub(gitHubUser: GitHubUser) {
  if (gitHubUser && gitHubUser.token) {
    octokit = new Octokit({
      auth: gitHubUser.token,
    });
  } else {
    chrome.action.setIcon({
      path: "icons/grey128.png",
    });
    return;
  }

  if (syncInProgress) {
    console.info("Another sync in progress. Skipping.");
    return;
  }
  console.info("Starting GitHub sync...");
  syncInProgress = true;
  try {
    await sync(gitHubUser.id);
  } catch (e) {
    chrome.action.setIcon({
      path: "icons/grey128.png",
    });
    throw e;
  } finally {
    syncInProgress = false;
  }
}
