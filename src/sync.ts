import { Octokit } from "@octokit/rest";
import { GitHubUser } from "./gitHubUser";
import {
  gitHubCallsCounter,
  resetGitHubCallsCounter,
  syncGitHubRepo,
} from "./github";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { Repo } from "./repo";
import { ReposState } from "./reposState";
import { RepoState } from "./repoState";
import {
  getGitHubUser,
  getNotMyTurnBlockList,
  getRepos,
  getRepoStateByFullName,
  storeNotMyTurnBlockList,
  storeRepoStateMap,
} from "./storage";

export async function trySync() {
  return getGitHubUser()
    .then((gitHubUser) => {
      trySyncWithCredentials(gitHubUser);
    })
    .catch((e) => {
      console.error("Sync failed", e);
    });
}

let syncInProgress = false;

export let octokit: Octokit;

export async function trySyncWithCredentials(gitHubUser: GitHubUser) {
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
  console.info("Starting sync...");
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

let syncStartUnixMillis = 0;

/**
 * Note: no concurrent calls!
 */
export async function sync(myGitHubUserId: number) {
  const blocksAtSyncStart = await getNotMyTurnBlockList();

  // #NOT_MATURE: what if it manages to exceed the quota in a single sync?
  await throttleGitHub();

  resetGitHubCallsCounter();
  syncStartUnixMillis = Date.now();
  const allReposIncludingDisabled = await getRepos();
  const repos = allReposIncludingDisabled.filter((v) => v.monitoringEnabled);
  const prevRepoStateByFullName = await getRepoStateByFullName();
  const repoStateByFullNameBuilder = new Map<string, RepoState>();
  // It's probably better to do these GitHub requests in a sequential manner so that GitHub is not
  // tempted to block them even if user monitors many repos:
  for (const repo of repos) {
    let repoState = prevRepoStateByFullName.get(repo.fullName());
    if (!repoState) {
      repoState = new RepoState(repo.fullName());
    }
    repoStateByFullNameBuilder.set(repo.fullName(), repoState);
    await syncGitHubRepo(repoState, myGitHubUserId);
  }
  const reposState = new ReposState(repoStateByFullNameBuilder);

  // Update in background:
  storeRepoStateMap(repoStateByFullNameBuilder);

  const blocksNow = await getNotMyTurnBlockList();
  if (blocksNow.length == blocksAtSyncStart.length) {
    const monitoringDisabledRepos = allReposIncludingDisabled.filter(
      (v) => !v.monitoringEnabled,
    );
    // In background:
    maybeCleanUpObsoleteBlocks(
      reposState.asArray(),
      blocksNow,
      monitoringDisabledRepos,
    );
  }

  console.log(gitHubCallsCounter + " GitHub API calls in the last sync.");

  await reposState.updateIcon();

  console.info("Sync finished.");
}

async function maybeCleanUpObsoleteBlocks(
  repoStates: RepoState[],
  notMyTurnBlocksFromStorage: NotMyTurnBlock[],
  monitoringDisabledRepos: Repo[],
) {
  if (Math.random() > 0.01) {
    return;
  }

  if (repoStates.some((r) => r.lastSyncResult.errorMsg)) {
    return;
  }

  const activeBlocksBuilder = new Set<NotMyTurnBlock>();
  for (const repoState of repoStates) {
    for (const myPR of repoState.lastSyncResult.myPRs) {
      notMyTurnBlocksFromStorage
        .filter((block) => myPR.isBlockedBy(block))
        .forEach((block) => activeBlocksBuilder.add(block));
    }
  }

  // Preserve blocks in case monitoring for a repo is temporary disabled and then re-enabled:
  for (const repo of monitoringDisabledRepos) {
    notMyTurnBlocksFromStorage
      // #NOT_MATURE: yes there's a low chance of false positives but that's okay:
      .filter((v) => v.prUrl.includes(repo.fullName()))
      .forEach((v) => activeBlocksBuilder.add(v));
  }

  if (notMyTurnBlocksFromStorage.length != activeBlocksBuilder.size) {
    return storeNotMyTurnBlockList([...activeBlocksBuilder]);
  }
}

// should prevent throttling by GitHub
async function throttleGitHub() {
  const secondsSinceLastSyncStart = (Date.now() - syncStartUnixMillis) / 1000;
  if (secondsSinceLastSyncStart < 2 * gitHubCallsCounter) {
    // to be on a safe side target 0.5 RPS (it's 5000 requests per hour quota):
    const waitMs = (2 * gitHubCallsCounter - secondsSinceLastSyncStart) * 1000;
    console.log(
      "Throttling GitHub calls to 0.5 RPS. Waiting for " + waitMs + "ms",
    );
    await delay(waitMs);
  }
}

export function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
