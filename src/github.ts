import {
  GetResponseDataTypeFromEndpointMethod,
  GetResponseTypeFromEndpointMethod,
} from "@octokit/types";
import { MyPR, ReviewOnMyPR, ReviewRequestOnMyPR } from "./myPR";
import { PR } from "./PR";
import { Repo, RepoType } from "./repo";
import { RepoState } from "./repoState";
import { RepoSyncResult } from "./repoSyncResult";
import { ReviewRequest } from "./reviewRequest";
import { ReviewState } from "./reviewState";
import { delay, octokit } from "./sync";

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

export let gitHubCallsCounter = 0;

export function resetGitHubCallsCounter() {
  gitHubCallsCounter = 0;
}

/**
 * @param repo The repo state will be updated as a result of the call.
 */
export async function syncGitHubRepo(repo: RepoState, myGitHubUserId: number) {
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
    const r = Repo.fromFullName(repo.fullName, RepoType.GITHUB);
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
    const r = Repo.fromFullName(repo.fullName, RepoType.GITHUB);
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
    const r = Repo.fromFullName(repo.fullName, RepoType.GITHUB);
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
