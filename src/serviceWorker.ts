import { Octokit } from "@octokit/rest";
import { sync, SyncStatus } from "./github";
import { getGitHubUser, GitHubUser } from "./storage";

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

setInterval(function () {
  // This also keeps the worker alive, as recommended by
  // https://developer.chrome.com/blog/longer-esw-lifetimes/
  getGitHubUser()
    .then((gitHubUser) => {
      syncWithGitHub(gitHubUser);
    })
    .catch((e) => {
      console.error("Sync failed", e);
    });
}, 30000);

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
    const syncResult = await sync(gitHubUser.id);
    console.log(`User PRs require attention: ${syncResult}`);
    let iconName: string;
    if (syncResult == SyncStatus.Grey) {
      iconName = "grey128.png";
    } else if (syncResult == SyncStatus.Red) {
      iconName = "red128.png";
    } else if (syncResult == SyncStatus.Yellow) {
      iconName = "yellow128.png";
    } else {
      iconName = "green128.png";
    }
    chrome.action.setIcon({
      path: "icons/" + iconName,
    });
    console.info("Sync finished.");
  } catch (e) {
    chrome.action.setIcon({
      path: "icons/yellow128.png",
    });
    throw e;
  } finally {
    syncInProgress = false;
  }
}
