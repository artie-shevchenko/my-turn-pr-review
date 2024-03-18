import {
  GetResponseDataTypeFromEndpointMethod,
  GetResponseTypeFromEndpointMethod,
} from "@octokit/types";
import { octokit } from "./serviceWorker";
import {
  getMonitoringEnabledRepos,
  getNotMyTurnBlockList,
  getRepos,
  getRepoStateByFullName,
  MyPR,
  NotMyTurnBlock,
  PR,
  Repo,
  RepoState,
  RepoSyncResult,
  ReviewOnMyPR,
  ReviewRequest,
  ReviewRequestOnMyPR,
  ReviewState,
  storeNotMyTurnBlockList,
  storeRepoStateMap,
} from "./storage";

const PULLS_PER_PAGE = 100;
const REVIEWS_PER_PAGE = 100;

type PullsListResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.pulls.list
>;
type PullsListResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.list
>;
type PullsListReviewsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.pulls.listReviews
>;
type PullsListReviewsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.listReviews
>;

type IssuesListEventsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.issues.listEvents
>;
type IssuesListEventsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.issues.listEvents
>;

let gitHubCallsCounter = 0;
let syncStartUnixMillis = 0;

export enum SyncStatus {
  Green = -1,
  Yellow = 0,
  Red = 1,
  Grey = 2,
}

export class ReposState {
  repoStateByFullName: Map<string, RepoState>;

  constructor(repoStateByFullName: Map<string, RepoState>) {
    this.repoStateByFullName = repoStateByFullName;
  }

  async updateIcon(
    monitoringEnabledRepos: Repo[] = undefined,
    notMyTurnBlocks: NotMyTurnBlock[] = undefined,
  ) {
    if (!monitoringEnabledRepos) {
      monitoringEnabledRepos = await getMonitoringEnabledRepos();
    }
    if (!notMyTurnBlocks) {
      notMyTurnBlocks = await getNotMyTurnBlockList();
    }
    let syncStatus = SyncStatus.Green;
    for (const repo of monitoringEnabledRepos) {
      const repoState = this.repoStateByFullName.get(repo.fullName());
      if (!repoState || !repoState.hasRecentSuccessfulSync()) {
        syncStatus = SyncStatus.Grey;
        break;
      }
      syncStatus = Math.max(syncStatus, repoState.getStatus(notMyTurnBlocks));
    }

    let iconName: string;
    if (syncStatus == SyncStatus.Grey) {
      iconName = "grey128.png";
    } else if (syncStatus == SyncStatus.Red) {
      iconName = "red128.png";
    } else if (syncStatus == SyncStatus.Yellow) {
      iconName = "yellow128.png";
    } else {
      iconName = "green128.png";
    }
    chrome.action.setIcon({
      path: "icons/" + iconName,
    });
    return syncStatus;
  }

  asArray() {
    return [...this.repoStateByFullName.values()];
  }
}

/**
 * Note: no concurrent calls!
 */
export async function sync(myGitHubUserId: number) {
  const blocksAtSyncStart = await getNotMyTurnBlockList();

  // #NOT_MATURE: what if it manages to exceed the quota in a single sync?
  await throttle();

  gitHubCallsCounter = 0;
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
    await syncRepo(repoState, myGitHubUserId);
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

  console.log(gitHubCallsCounter + " GitHub API calls in the last sync");

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

/**
 * Returns 2 for grey icon, 1 for red, 0 for yellow, -1 for green..
 *
 * @param repo The repo state will be updated as a result of the call.
 */
async function syncRepo(repo: RepoState, myGitHubUserId: number) {
  const repoSyncResult = new RepoSyncResult();
  repoSyncResult.syncStartUnixMillis = Date.now();
  const requestsForMyReviewBuilder = [] as ReviewRequest[];
  const myPRsToSyncBuilder = [] as PullsListResponseDataType[0][];

  try {
    let pageNumber = 1;
    let pullsListResponse: PullsListResponseType;
    do {
      pullsListResponse = await listPullRequests(repo, pageNumber);
      for (const arrayElement of pullsListResponse.data) {
        const pr = arrayElement as PullsListResponseDataType[0];
        if (pr.user.id == myGitHubUserId) {
          myPRsToSyncBuilder.push(pr);
        } else {
          // Somebody else's PR
          for (const reviewer of pr.requested_reviewers) {
            if (reviewer.id === myGitHubUserId) {
              const reviewRequest = await syncRequestForMyReview(
                pr,
                repo,
                myGitHubUserId,
              );
              requestsForMyReviewBuilder.push(reviewRequest);
            }
          }
        }
      }
      pageNumber++;
    } while (pullsListResponse.data.length > 0);
    // If review request was withdrawn and then re-requested again the first request will be
    // (correctly) ignored:
    repoSyncResult.requestsForMyReview = requestsForMyReviewBuilder;

    const myPRsBuilder = [] as MyPR[];
    for (const pr of myPRsToSyncBuilder) {
      const myPR = await syncMyPR(pr, repo);
      myPRsBuilder.push(myPR);
    }
    repoSyncResult.myPRs = myPRsBuilder;

    repo.lastSuccessfulSyncResult = repoSyncResult;
    repo.lastSyncResult = repoSyncResult;
  } catch (e) {
    console.warn(
      `Error listing pull requests from ${repo.fullName}. Ignoring it.`,
      e,
    );
    repoSyncResult.errorMsg = e + "";
    repo.lastSyncResult = repoSyncResult;
  }
}

async function syncMyPR(pr: PullsListResponseDataType[0], repo: RepoState) {
  const reviewsRequested = pr.requested_reviewers.map((reviewer) => {
    const url = pr.html_url;
    // To have an up-to-date title:
    const pullRequest = new PR(url, pr.title);
    return new ReviewRequestOnMyPR(pullRequest, reviewer.id);
  });

  // Now query reviews already received:
  let reviews: PullsListReviewsResponseDataType = [];
  let pageNumber = 1;
  let reviewsBatch = await listReviews(repo, pr.number, pageNumber);
  while (reviewsBatch.data.length >= REVIEWS_PER_PAGE) {
    reviews = reviews.concat(reviewsBatch.data);
    pageNumber++;
    reviewsBatch = await listReviews(repo, pr.number, pageNumber);
  }
  reviews = reviews.concat(reviewsBatch.data);

  const prObj = new PR(pr.html_url, pr.title);
  const reviewsReceived = reviews.map((review) => {
    const state = review.state;
    const typedState = state as keyof typeof ReviewState;
    return new ReviewOnMyPR(
      prObj,
      review.user.id,
      ReviewState[typedState],
      Date.parse(review.submitted_at),
    );
  });
  return MyPR.ofGitHubResponses(
    prObj,
    reviewsReceived,
    reviewsRequested,
    pr.user.id,
  );
}

async function syncRequestForMyReview(
  pr: PullsListResponseDataType[0],
  repo: RepoState,
  myGitHubUserId: number,
): Promise<ReviewRequest> {
  let reviewRequestedUnixMillis: number;
  try {
    reviewRequestedUnixMillis = await getLatestReviewRequestedEventTimestamp(
      pr,
      repo,
      myGitHubUserId,
    );
  } catch (e) {
    console.error(
      "Couldn't get the real review_requested timestamp. Will use an approximation instead.",
      e,
    );
  }

  const url = pr.html_url;
  let matchingReviewRequests = [] as ReviewRequest[];
  if (
    repo.lastSuccessfulSyncResult &&
    repo.lastSuccessfulSyncResult.requestsForMyReview
  ) {
    matchingReviewRequests =
      repo.lastSuccessfulSyncResult.requestsForMyReview.filter((existing) => {
        const existingUrl = existing.pr.url;
        return existingUrl === url;
      });
  }
  // To have an up-to-date title:
  const pullRequest = new PR(url, pr.title);
  if (matchingReviewRequests.length == 0) {
    return new ReviewRequest(
      pullRequest,
      reviewRequestedUnixMillis ? reviewRequestedUnixMillis : Date.now(),
    );
  } else {
    const existingReviewRequest = matchingReviewRequests[0];
    return new ReviewRequest(
      pullRequest,
      reviewRequestedUnixMillis
        ? reviewRequestedUnixMillis
        : existingReviewRequest.firstTimeObservedUnixMillis,
    );
  }
}

async function getLatestReviewRequestedEventTimestamp(
  pr: PullsListResponseDataType[0],
  repo: RepoState,
  myGitHubUserId: number,
): Promise<number> {
  let result = 0;
  let pageNumber = 1;
  let eventsListResponse: IssuesListEventsResponseType;
  do {
    eventsListResponse = await listEvents(repo, pr.number, pageNumber);
    for (const arrayElement of eventsListResponse.data) {
      const event = arrayElement as IssuesListEventsResponseDataType[0];
      if (
        event.event === "review_requested" &&
        event.requested_reviewer.id === myGitHubUserId
      ) {
        result = Math.max(result, new Date(event.created_at).getTime());
      }
    }
    pageNumber++;
  } while (eventsListResponse.data.length > 0);
  return result;
}

async function listPullRequests(
  repo: RepoState,
  pageNumber: number,
  retryNumber = 0,
): Promise<PullsListResponseType> {
  try {
    // A little hack just to get repo owner and name:
    const r = Repo.fromFullName(repo.fullName);
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    gitHubCallsCounter++;
    return await octokit.pulls.list({
      owner: r.owner,
      repo: r.name,
      state: "open",
      per_page: PULLS_PER_PAGE,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > 2) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listPullRequests(repo, pageNumber, retryNumber + 1);
    }
  }
}

async function listReviews(
  repo: RepoState,
  pullNumber: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<PullsListReviewsResponseType> {
  try {
    // A little hack just to get repo owner and name:
    const r = Repo.fromFullName(repo.fullName);
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    gitHubCallsCounter++;
    return await octokit.pulls.listReviews({
      owner: r.owner,
      repo: r.name,
      pull_number: pullNumber,
      per_page: PULLS_PER_PAGE,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > 2) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listReviews(repo, pullNumber, pageNumber, retryNumber + 1);
    }
  }
}

async function listEvents(
  repo: RepoState,
  pullNumber: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<IssuesListEventsResponseType> {
  try {
    // A little hack just to get repo owner and name:
    const r = Repo.fromFullName(repo.fullName);
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    gitHubCallsCounter++;
    return await octokit.issues.listEvents({
      owner: r.owner,
      repo: r.name,
      issue_number: pullNumber,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > 2) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listEvents(repo, pullNumber, pageNumber, retryNumber + 1);
    }
  }
}

// should prevent throttling by GitHub
async function throttle() {
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

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
