import { Octokit } from "@octokit/rest";
import { GitHubUser } from "./gitHubUser";
import {
  getUser,
  gitHubCallsCounter,
  listRecentNotifications,
  listUserTeams,
  resetGitHubCallsCounter,
  syncGitHubRepo,
} from "./github";
import {
  CommentBlock,
  NotMyTurnBlock,
  NotMyTurnReviewRequestBlock,
} from "./notMyTurnBlock";
import { Repo } from "./repo";
import { ReposState } from "./reposState";
import { RepoState } from "./repoState";
import {
  getCommentBlockList,
  getGitHubUser,
  getNotMyTurnBlockList,
  getNotMyTurnReviewRequestBlockList,
  getRepos,
  getRepoStateByFullName,
  getSettings,
  storeCommentBlockList,
  storeLastSyncDurationMillis,
  storeNotMyTurnBlockList,
  storeNotMyTurnReviewRequestBlockList,
  storeRepoStateMap,
} from "./storage";

export async function trySync() {
  return getGitHubUser()
    .then((gitHubUser) => {
      return trySyncWithCredentials(gitHubUser);
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
  } finally {
    syncInProgress = false;
  }
}

/**
 * Note: no concurrent calls!
 */
export async function sync(myGitHubUser: GitHubUser) {
  const prBlocksAtSyncStart = await getNotMyTurnBlockList();
  const reviewRequestBlocksAtSyncStart =
    await getNotMyTurnReviewRequestBlockList();
  const commentBlocksAtSyncStart = await getCommentBlockList();

  resetGitHubCallsCounter();
  const syncStartUnixMillis = Date.now();
  const settings = await getSettings();
  const allReposIncludingDisabled = await getRepos();
  const repos = allReposIncludingDisabled.filter((v) => v.monitoringEnabled);
  const prevRepoStateByFullName = await getRepoStateByFullName();
  const repoStateByFullNameBuilder = new Map<string, RepoState>();

  // used purely as a starting point (#NOT_MATURE: what if user unsubscribed from them?):
  const recentNotifications = await listRecentNotifications(
    settings.getMinCommentCreateDate(),
  );

  const user = (await getUser()).data;
  myGitHubUser.login = user.login;
  const userTeams = await listUserTeams();
  myGitHubUser.teamIds = userTeams.map((v) => v.id);

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

  const reviewRequestBlocksNow = await getNotMyTurnReviewRequestBlockList();
  if (reviewRequestBlocksNow.length === reviewRequestBlocksAtSyncStart.length) {
    const monitoringDisabledRepos = allReposIncludingDisabled.filter(
      (v) => !v.monitoringEnabled,
    );
    // In background:
    maybeCleanUpObsoleteReviewRequestBlocks(
      reposState.asArray(),
      reviewRequestBlocksNow,
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

  storeLastSyncDurationMillis(Date.now() - syncStartUnixMillis);
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

async function maybeCleanUpObsoleteReviewRequestBlocks(
  repoStates: RepoState[],
  notMyTurnReviewRequestBlocks: NotMyTurnReviewRequestBlock[],
  monitoringDisabledRepos: Repo[],
) {
  if (Math.random() > 0.01) {
    return;
  }

  if (repoStates.some((r) => r.lastSyncResult.errorMsg)) {
    return;
  }

  const activeBlocksBuilder = new Set<NotMyTurnReviewRequestBlock>();
  for (const repoState of repoStates) {
    for (const reviewRequest of repoState.lastSyncResult.requestsForMyReview) {
      notMyTurnReviewRequestBlocks
        .filter((block) => reviewRequest.isBlockedBy(block))
        .forEach((block) => activeBlocksBuilder.add(block));
    }
  }

  // Preserve blocks in case monitoring for a repo is temporary disabled and then re-enabled:
  for (const repo of monitoringDisabledRepos) {
    notMyTurnReviewRequestBlocks
      // #NOT_MATURE: yes there's a low chance of false positives but that's okay:
      .filter((v) => v.prUrl.includes(repo.fullName()))
      .forEach((v) => activeBlocksBuilder.add(v));
  }

  if (notMyTurnReviewRequestBlocks.length != activeBlocksBuilder.size) {
    return storeNotMyTurnReviewRequestBlockList([...activeBlocksBuilder]);
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
      // #NOT_MATURE: if user increases max comment age in settings a comment would be resurrected,
      // but probably that's okay:
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
