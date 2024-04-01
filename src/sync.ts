import { Octokit } from "@octokit/rest";
import { GitHubUser } from "./gitHubUser";
import {
  gitHubCallsCounter,
  listRecentNotifications,
  resetGitHubCallsCounter,
  syncGitHubRepo,
} from "./github";
import { CommentBlock, NotMyTurnBlock } from "./notMyTurnBlock";
import { Repo } from "./repo";
import { ReposState } from "./reposState";
import { RepoState } from "./repoState";
import {
  getCommentBlockList,
  getGitHubUser,
  getNotMyTurnBlockList,
  getRepos,
  getRepoStateByFullName,
  getSettings,
  storeCommentBlockList,
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
    await sync(gitHubUser);
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
export async function sync(myGitHubUser: GitHubUser) {
  const prBlocksAtSyncStart = await getNotMyTurnBlockList();
  const commentBlocksAtSyncStart = await getCommentBlockList();

  // #NOT_MATURE: what if it manages to exceed the quota in a single sync?
  await throttleGitHub();

  resetGitHubCallsCounter();
  syncStartUnixMillis = Date.now();
  const settings = await getSettings();
  const allReposIncludingDisabled = await getRepos();
  const repos = allReposIncludingDisabled.filter((v) => v.monitoringEnabled);
  const prevRepoStateByFullName = await getRepoStateByFullName();
  const repoStateByFullNameBuilder = new Map<string, RepoState>();

  // used purely as a starting point (#NOT_MATURE: what if user unsubscribed from them?):
  const recentNotifications = await listRecentNotifications(
    settings.getMinCommentCreateDate(),
  );

  // It's probably better to do these GitHub requests in a sequential manner so that GitHub is not
  // tempted to block them even if user monitors many repos:
  for (const repo of repos) {
    let repoState = prevRepoStateByFullName.get(repo.fullName());
    if (!repoState) {
      repoState = new RepoState(repo.fullName());
    }
    repoStateByFullNameBuilder.set(repo.fullName(), repoState);

    const repoRecentNotifications = recentNotifications.filter(
      (n) =>
        n.repository.name === repo.name &&
        n.repository.owner.login === repo.owner,
    );

    await syncGitHubRepo(
      repoState,
      repoRecentNotifications,
      myGitHubUser,
      settings,
    );
  }
  const reposState = new ReposState(repoStateByFullNameBuilder);

  // Update in background:
  storeRepoStateMap(repoStateByFullNameBuilder);

  const prBlocksNow = await getNotMyTurnBlockList();
  if (prBlocksNow.length === prBlocksAtSyncStart.length) {
    const monitoringDisabledRepos = allReposIncludingDisabled.filter(
      (v) => !v.monitoringEnabled,
    );
    // In background:
    maybeCleanUpObsoletePrBlocks(
      reposState.asArray(),
      prBlocksNow,
      monitoringDisabledRepos,
    );
  }

  const commentBlocksNow = await getCommentBlockList();
  if (commentBlocksNow.length === commentBlocksAtSyncStart.length) {
    const monitoringDisabledRepos = allReposIncludingDisabled.filter(
      (v) => !v.monitoringEnabled,
    );
    // In background:
    maybeCleanUpObsoleteCommentBlocks(
      reposState.asArray(),
      commentBlocksNow,
      monitoringDisabledRepos,
    );
  }

  console.log(gitHubCallsCounter + " GitHub API calls in the last sync.");

  await reposState.updateIcon();

  console.info("Sync finished.");
}

async function maybeCleanUpObsoletePrBlocks(
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

async function maybeCleanUpObsoleteCommentBlocks(
  repoStates: RepoState[],
  commentBlocksFromStorage: CommentBlock[],
  monitoringDisabledRepos: Repo[],
) {
  if (Math.random() > 0.01) {
    return;
  }

  if (repoStates.some((r) => r.lastSyncResult.errorMsg)) {
    return;
  }

  const activeBlocksBuilder = new Set<CommentBlock>();
  for (const repoState of repoStates) {
    for (const comment of repoState.lastSyncResult.comments) {
      commentBlocksFromStorage
        .filter((block) => comment.isBlockedBy(block))
        .forEach((block) => activeBlocksBuilder.add(block));
    }
  }

  // Preserve blocks in case monitoring for a repo is temporary disabled and then re-enabled:
  for (const repo of monitoringDisabledRepos) {
    commentBlocksFromStorage
      // #NOT_MATURE: yes there's a low chance of false positives but that's okay:
      .filter((v) => v.commentUrl.includes(repo.fullName()))
      .forEach((v) => activeBlocksBuilder.add(v));
  }

  if (commentBlocksFromStorage.length != activeBlocksBuilder.size) {
    return storeCommentBlockList([...activeBlocksBuilder]);
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
