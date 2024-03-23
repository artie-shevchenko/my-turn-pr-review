import { Octokit } from "@octokit/rest";
import { GitLabUser } from "./gitLabUser";
import { RepoSyncResult } from "./repoSyncResult";
import { resetGitLabCallsCounter, syncGitLabRepo } from "./gitlab";
import {
  gitHubCallsCounter,
  resetGitHubCallsCounter,
  syncGitHubRepo,
} from "./github";
import { GitHubUser } from "./gitHubUser";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { Repo, RepoType } from "./repo";
import { ReposState } from "./reposState";
import { RepoState } from "./repoState";
import {
  getGitHubUser,
  getGitLabUser,
  getNotMyTurnBlockList,
  getRepos,
  getReposState,
  storeNotMyTurnBlockList,
  storeRepoStateList,
} from "./storage";

export async function trySync() {
  const gitHubUser = await getGitHubUser();
  const gitLabUser = await getGitLabUser();
  trySyncWithCredentials(gitHubUser, gitLabUser).catch((e) => {
    console.error("Sync failed", e);
  });
}

let syncInProgress = false;

export let octokit: Octokit;

export async function trySyncWithCredentials(
  gitHubUser: GitHubUser,
  gitLabUser: GitLabUser,
) {
  if (gitHubUser && gitHubUser.token) {
    octokit = new Octokit({
      auth: gitHubUser.token,
    });
  }
  if (gitLabUser && gitLabUser.token) {
    // TODO(29): init gitLab library here?
  }

  if (syncInProgress) {
    console.info("Another sync in progress. Skipping.");
    return;
  }
  console.info("Starting sync...");
  syncInProgress = true;
  try {
    await sync(
      gitHubUser ? gitHubUser.id : undefined,
      gitLabUser ? gitLabUser.id : undefined,
    );
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
 *
 * @param myGitHubUserId if GitHub token provided and valid should be present.
 * @param myGitLabUserId if GitLab token provided and valid should be present.
 */
export async function sync(myGitHubUserId: number, myGitLabUserId: number) {
  const blocksAtSyncStart = await getNotMyTurnBlockList();

  // #NOT_MATURE: what if it manages to exceed the quota in a single sync?
  await throttleGitHub();

  resetGitHubCallsCounter();
  resetGitLabCallsCounter();
  syncStartUnixMillis = Date.now();
  const allReposIncludingDisabled = await getRepos();
  const repos = allReposIncludingDisabled.filter((v) => v.monitoringEnabled);
  const prevReposState = await getReposState();
  const repoStateListBuilder = [] as RepoState[];
  // It's probably better to do these GitHub requests in a sequential manner so that GitHub is not
  // tempted to block them even if user monitors many repos:
  for (const repo of repos) {
    let repoState = prevReposState.getState(repo);
    if (!repoState) {
      repoState = new RepoState(repo.type, repo.fullName());
    }
    repoStateListBuilder.push(repoState);
    if (repo.type === RepoType.GITHUB) {
      if (myGitHubUserId) {
        await syncGitHubRepo(repoState, myGitHubUserId);
      } else {
        repoState.lastSyncResult = new RepoSyncResult(
          [],
          [],
          Date.now(),
          "No valid GitHub token",
        );
        chrome.action.setIcon({
          path: "icons/grey128.png",
        });
      }
    } else if (repo.type === RepoType.GITLAB) {
      // #NOT_MATURE: can sync GitLab in parallel with GitHub as throttling is per-service:
      if (myGitLabUserId) {
        await syncGitLabRepo(repoState, myGitLabUserId);
      } else {
        repoState.lastSyncResult = new RepoSyncResult(
          [],
          [],
          Date.now(),
          "No valid GitLab token",
        );
        chrome.action.setIcon({
          path: "icons/grey128.png",
        });
      }
    } else {
      // TODO: throw unsupported type.
    }
  }
  const reposState = new ReposState(repoStateListBuilder);

  // Update in background:
  storeRepoStateList(repoStateListBuilder);

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
