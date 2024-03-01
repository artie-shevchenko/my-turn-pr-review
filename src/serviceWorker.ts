import { sync } from "./github";
import { getGitHubUser, GitHubUser, storeRepos } from "./storage";
import { Octokit } from "@octokit/rest";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason == "install") {
    await storeRepos([]);

    chrome.action.setIcon({
      path: "icons/yellow128.png",
    });

    console.log("Extension successfully installed!");
  }
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
}, 10000);

// Watch for changes to the user's options & apply them
chrome.storage.onChanged.addListener(() => {
  console.log("Triggering sync as repo set may be changed.");
  getGitHubUser()
    .then((gitHubUser) => {
      syncWithGitHub(gitHubUser);
    })
    .catch((e) => {
      console.error("Sync failed", e);
    });
});

let syncInProgress = false;

export async function syncWithGitHub(gitHubUser: GitHubUser) {
  if (gitHubUser && gitHubUser.token) {
    octokit = new Octokit({
      auth: gitHubUser.token,
    });
  } else {
    chrome.action.setIcon({
      path: "icons/yellow128.png",
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
    if (syncResult > 0) {
      iconName = "red128.png";
    } else if (syncResult == 0) {
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
