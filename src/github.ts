import { octokit } from "./serviceWorker";
import {
  getRepos,
  getRepoStateByFullName,
  PR,
  Repo,
  RepoState,
  RepoSyncResult,
  ReviewRequest,
  storeRepoStateMap,
} from "./storage";
import {
  GetResponseDataTypeFromEndpointMethod,
  GetResponseTypeFromEndpointMethod,
} from "@octokit/types";

const PULLS_PER_PAGE = 100;

type PullsListResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.pulls.list
>;
type PullsListResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.list
>;

/**
 * Returns negative if all good, 0 if attention may be needed or positive if attention is required
 * for some PRs. TODO: return enum instead.
 */
export async function sync(gitHubUserId: number): Promise<number> {
  const reposByFullName = await getRepos();
  const repoStateByFullName = await getRepoStateByFullName();
  const newRepoStateByFullName = new Map<string, RepoState>();
  let result = -1;
  // It's probably better to do these GitHub requests in a sequential manner so that GitHub is not
  // tempted to block them even if user monitors many repos:
  for (const repo of reposByFullName) {
    let repoState = repoStateByFullName.get(repo.fullName());
    if (!repo.monitoringEnabled) {
      if (repoState) {
        // Preserve the state just in case it gets enabled later (given the hacky way of computing
        // review request staleness):
        newRepoStateByFullName.set(repo.fullName(), repoState);
      }
      continue;
    }
    if (!repoState) {
      repoState = new RepoState(repo.fullName());
    }
    newRepoStateByFullName.set(repo.fullName(), repoState);
    result = Math.max(result, await syncRepo(repoState, gitHubUserId));
  }

  // Update in background:
  storeRepoStateMap(newRepoStateByFullName);

  return result;
}

/**
 * Returns true if any reviews requested.
 *
 * @param repo The repo state will be updated as a result of the call.
 */
async function syncRepo(
  repo: RepoState,
  gitHubUserId: number,
): Promise<number> {
  const repoSyncResult = new RepoSyncResult();
  repoSyncResult.syncStartUnixMillis = Date.now();
  try {
    let prList: PullsListResponseDataType = [];
    let pageNumber = 1;
    let pullsListBatch = await listPullRequests(repo, pageNumber);
    while (pullsListBatch.data.length >= PULLS_PER_PAGE) {
      prList = prList.concat(pullsListBatch.data);
      pageNumber++;
      pullsListBatch = await listPullRequests(repo, pageNumber);
    }
    prList = prList.concat(pullsListBatch.data);

    console.log(`Total ${prList.length} PRs in: ${repo.fullName}.`);
    const newReviewsRequested = [] as ReviewRequest[];
    prList.forEach((pr) => {
      pr.requested_reviewers.forEach((reviewer) => {
        if (reviewer.id === gitHubUserId) {
          const url = pr.html_url;
          let matchingReviewRequests = [] as ReviewRequest[];
          if (repo.lastSuccessfulSyncResult) {
            matchingReviewRequests =
              repo.lastSuccessfulSyncResult.reviewRequestList.filter(
                (existing) => {
                  const existingUrl = existing.pr.url;
                  return existingUrl === url;
                },
              );
          }
          // To have an up-to-date title:
          const pullRequest = new PR(url, pr.title);
          if (matchingReviewRequests.length == 0) {
            newReviewsRequested.push(
              new ReviewRequest(pullRequest, Date.now()),
            );
          } else {
            const existingReviewRequest = matchingReviewRequests[0];
            newReviewsRequested.push(
              new ReviewRequest(
                pullRequest,
                existingReviewRequest.firstTimeObservedUnixMillis,
              ),
            );
          }
        }
      });
    });
    // If review request was withdrawn and then re-requested again the first request will be
    // (correctly) ignored:
    repoSyncResult.reviewRequestList = newReviewsRequested;
    repo.lastSuccessfulSyncResult = repoSyncResult;
    repo.lastSyncResult = repoSyncResult;
    return repoSyncResult.reviewRequestList.length > 0 ? 1 : -1;
  } catch (e) {
    console.warn(
      `Error listing pull requests from ${repo.fullName}. Ignoring it.`,
      e,
    );
    repoSyncResult.errorMsg = e + "";
    repo.lastSyncResult = repoSyncResult;

    // Same as in populate from popup.ts:
    // After 5 minutes of unsuccessful syncs, don't visualize the reviews requested:
    if (
      repo.lastSuccessfulSyncResult &&
      repo.lastSuccessfulSyncResult.isRecent()
    ) {
      // Use the last successful sync results:
      return repo.lastSuccessfulSyncResult.reviewRequestList.length > 0
        ? 1
        : -1;
    } else {
      // Show a yellow icon:
      return 0;
    }
  }
}

export async function listPullRequests(
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
    if (retryNumber > 3) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listPullRequests(repo, pageNumber, retryNumber + 1);
    }
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
