import {
  GetResponseDataTypeFromEndpointMethod,
  GetResponseTypeFromEndpointMethod,
} from "@octokit/types";
import { Comment } from "./comment";
import { GitHubUser } from "./gitHubUser";
import { MyPR, ReviewOnMyPR, ReviewRequestOnMyPR } from "./myPR";
import { PR } from "./PR";
import { Repo, RepoType } from "./repo";
import { RepoState } from "./repoState";
import { RepoSyncResult } from "./repoSyncResult";
import { ReviewRequest } from "./reviewRequest";
import { ReviewState } from "./reviewState";
import { Settings } from "./settings";
import { octokit } from "./sync";

const MAX_NUMBER_OF_RETRIES = 3;
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
type ListNotificationsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.activity.listNotificationsForAuthenticatedUser
>;
type ListNotificationsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.activity.listNotificationsForAuthenticatedUser
>;
type PullsListCommentsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.pulls.listReviewComments
>;
type PullsListCommentsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.listReviewComments
>;
type IssuesListCommentsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.issues.listComments
>;
type IssuesListCommentsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.issues.listComments
>;
type PullsListReactionsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.reactions.listForPullRequestReviewComment
>;
type PullsListReactionsResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.reactions.listForPullRequestReviewComment
>;
type IssuesListReactionsResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.reactions.listForIssueComment
>;
type IssuesListReactionsResponseDataType =
  GetResponseDataTypeFromEndpointMethod<
    typeof octokit.reactions.listForIssueComment
  >;

export let gitHubCallsCounter = 0;

export function resetGitHubCallsCounter() {
  gitHubCallsCounter = 0;
}

/**
 * Returns 2 for grey icon, 1 for red, 0 for yellow, -1 for green..
 *
 * @param repo The repo state will be updated as a result of the call.
 */
export async function syncGitHubRepo(
  repo: RepoState,
  recentNotifications: ListNotificationsResponseDataType[0][],
  myGitHubUser: GitHubUser,
  settings: Settings,
) {
  const repoSyncResult = new RepoSyncResult();
  repoSyncResult.syncStartUnixMillis = Date.now();
  repoSyncResult.ignoredCommentsMoreThanXDaysOld =
    settings.ignoreCommentsMoreThanXDaysOld;
  const requestsForMyReviewBuilder = [] as ReviewRequest[];
  const myPRsToSyncBuilder = [] as PullsListResponseDataType[0][];

  try {
    let pageNumber = 1;
    let pullsListResponse: PullsListResponseType;
    do {
      pullsListResponse = await listPullRequests(repo, pageNumber);
      for (const arrayElement of pullsListResponse.data) {
        const pr = arrayElement as PullsListResponseDataType[0];
        if (pr.user.id == myGitHubUser.id) {
          myPRsToSyncBuilder.push(pr);
        } else {
          // Somebody else's PR
          for (const reviewer of pr.requested_reviewers) {
            if (reviewer.id === myGitHubUser.id) {
              const reviewRequest = await syncRequestForMyReview(
                pr,
                repo,
                myGitHubUser.id,
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

    // Sync my PRs:

    const myPRsBuilder = [] as MyPR[];
    for (const pr of myPRsToSyncBuilder) {
      const myPR = await syncMyPR(pr, repo);
      myPRsBuilder.push(myPR);
    }
    repoSyncResult.myPRs = myPRsBuilder;

    // Sync comments:

    const commentsBuilder = [] as Comment[];
    for (const notification of recentNotifications) {
      if (notification.subject.type !== "PullRequest") {
        continue;
      }
      const prUrl = notification.subject.url;
      const prNumber = Number.parseInt(
        prUrl.substring(prUrl.lastIndexOf("/") + 1),
      );
      const pullCommentsGroupedByIdOfFirstCommentInThread =
        await getPullCommentsGroupedByIdOfFirstCommentInThread(
          notification.repository.owner.login,
          notification.repository.name,
          prNumber,
        );
      for (const [
        ,
        commentsThread,
      ] of pullCommentsGroupedByIdOfFirstCommentInThread) {
        let iCommentedOnThread = false;
        let commentMakingItMyTurn: PullsListCommentsResponseDataType[0];
        for (const comment of commentsThread) {
          if (comment.user.id === myGitHubUser.id) {
            iCommentedOnThread = true;
          }

          if (
            new Date(comment.created_at) < settings.getMinCommentCreateDate()
          ) {
            continue;
          }

          if (comment.user.id === myGitHubUser.id) {
            // I already responded:
            commentMakingItMyTurn = undefined;
            continue;
          }

          if (
            iCommentedOnThread ||
            // #NOT_MATURE: should be followed by " " or tab etc
            comment.body.indexOf("@" + myGitHubUser.login) >= 0
          ) {
            // check if there are any reactions from my side is made later:
            commentMakingItMyTurn = comment;
          }
        }
        if (commentMakingItMyTurn) {
          const reactions = await listPullCommentReactions(
            notification.repository.owner.login,
            notification.repository.name,
            commentMakingItMyTurn.id,
          );
          if (!reactions.some((r) => r.user.id === myGitHubUser.id)) {
            // I haven't reacted to it:
            commentsBuilder.push(
              new Comment(
                commentMakingItMyTurn.html_url,
                new PR(prUrl, notification.subject.title),
                commentMakingItMyTurn.body,
                commentMakingItMyTurn.user.login,
                new Date(commentMakingItMyTurn.created_at).getTime(),
              ),
            );
          }
        }
      }
      const issueCommentsSortedByCreatedAtAsc =
        await getIssueCommentsSortedByCreatedAtAsc(
          notification.repository.owner.login,
          notification.repository.name,
          prNumber,
        );
      let commentMakingItMyTurn: IssuesListCommentsResponseDataType[0];
      for (const comment of issueCommentsSortedByCreatedAtAsc) {
        if (new Date(comment.created_at) < settings.getMinCommentCreateDate()) {
          continue;
        }

        if (comment.user.id === myGitHubUser.id) {
          // I already responded:
          commentMakingItMyTurn = undefined;
          continue;
        }

        // Only mentions are supported for issue comments (as there are often tons of spam from
        // automation): #NOT_MATURE: should be followed by " " or tab etc
        if (comment.body.indexOf("@" + myGitHubUser.login) >= 0) {
          // check if there are any reactions from my side is made later:
          commentMakingItMyTurn = comment;
        }
      }
      if (commentMakingItMyTurn) {
        const reactions = await listIssueCommentReactions(
          notification.repository.owner.login,
          notification.repository.name,
          commentMakingItMyTurn.id,
        );
        if (!reactions.some((r) => r.user.id === myGitHubUser.id)) {
          // I haven't reacted to it:
          commentsBuilder.push(
            new Comment(
              commentMakingItMyTurn.html_url,
              new PR(prUrl, notification.subject.title),
              commentMakingItMyTurn.body,
              commentMakingItMyTurn.user.login,
              new Date(commentMakingItMyTurn.created_at).getTime(),
            ),
          );
        }
      }
    }
    repoSyncResult.comments = commentsBuilder;

    repo.lastSuccessfulSyncResult = repoSyncResult;
    repo.lastSyncResult = repoSyncResult;
  } catch (e) {
    console.warn(`Error syncing ${repo.fullName}. Ignoring it.`, e);
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
    await throttleGitHub();
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
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
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
    await throttleGitHub();
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
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
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
    await throttleGitHub();
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
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listEvents(repo, pullNumber, pageNumber, retryNumber + 1);
    }
  }
}

export async function listRecentNotifications(
  since: Date,
): Promise<ListNotificationsResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: ListNotificationsResponseType;
  do {
    response = await listRecentNotificationsPage(since, pageNumber);
    for (const arrayElement of response.data) {
      if (
        arrayElement.reason === "author" ||
        arrayElement.reason === "review_requested" ||
        arrayElement.reason === "mention"
      ) {
        result.push(arrayElement as ListNotificationsResponseDataType[0]);
      }
    }
    pageNumber++;
  } while (response.data.length > 0);
  return result;
}

async function listRecentNotificationsPage(
  since: Date,
  pageNumber: number,
  retryNumber = 0,
): Promise<ListNotificationsResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.activity.listNotificationsForAuthenticatedUser({
      all: true,
      participating: true,
      since: since.toISOString(),
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listRecentNotificationsPage(
        since,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

/** In each thread comments are ordered by their created_at date. */
export async function getPullCommentsGroupedByIdOfFirstCommentInThread(
  repoOwner: string,
  repoName: string,
  pullNumber: number,
): Promise<Map<number, PullsListCommentsResponseDataType[0][]>> {
  const resultBuilder = new Map<
    number,
    PullsListCommentsResponseDataType[0][]
  >();
  let pageNumber = 1;
  let response: PullsListCommentsResponseType;
  do {
    response = await listPullCommentsPageOrderedByIdAsc(
      repoOwner,
      repoName,
      pullNumber,
      pageNumber,
    );
    for (const arrayElement of response.data) {
      if (arrayElement.in_reply_to_id) {
        const thread = resultBuilder.get(arrayElement.in_reply_to_id);
        if (thread) {
          thread.push(arrayElement);
        } else {
          console.error(
            "impossible - original comment not found. ignoring comment",
          );
        }
      } else {
        resultBuilder.set(arrayElement.id, [arrayElement]);
      }
    }
    pageNumber++;
  } while (response.data.length > 0);

  return resultBuilder;
}

async function listPullCommentsPageOrderedByIdAsc(
  repoOwner: string,
  repoName: string,
  pullNumber: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<PullsListCommentsResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.pulls.listReviewComments({
      owner: repoOwner,
      repo: repoName,
      pull_number: pullNumber,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listPullCommentsPageOrderedByIdAsc(
        repoOwner,
        repoName,
        pullNumber,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

async function listPullCommentReactions(
  repoOwner: string,
  repoName: string,
  commentId: number,
): Promise<PullsListReactionsResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: PullsListReactionsResponseType;
  do {
    response = await listPullCommentReactionsPage(
      repoOwner,
      repoName,
      commentId,
      pageNumber,
    );
    for (const arrayElement of response.data) {
      result.push(arrayElement as PullsListReactionsResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length > 0);
  return result;
}

async function listPullCommentReactionsPage(
  repoOwner: string,
  repoName: string,
  commentId: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<PullsListReactionsResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.reactions.listForPullRequestReviewComment({
      owner: repoOwner,
      repo: repoName,
      comment_id: commentId,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listPullCommentReactionsPage(
        repoOwner,
        repoName,
        commentId,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

/** In each thread comments are ordered by their created_at date. */
export async function getIssueCommentsSortedByCreatedAtAsc(
  repoOwner: string,
  repoName: string,
  issueNumber: number,
): Promise<IssuesListCommentsResponseDataType[0][]> {
  const resultBuilder = [] as IssuesListCommentsResponseDataType[0][];
  let pageNumber = 1;
  let response: IssuesListCommentsResponseType;
  do {
    response = await listIssueCommentsPageOrderedByIdAsc(
      repoOwner,
      repoName,
      issueNumber,
      pageNumber,
    );
    for (const arrayElement of response.data) {
      resultBuilder.push(arrayElement);
    }
    pageNumber++;
  } while (response.data.length > 0);

  return resultBuilder;
}

async function listIssueCommentsPageOrderedByIdAsc(
  repoOwner: string,
  repoName: string,
  issueNumber: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<IssuesListCommentsResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.issues.listComments({
      owner: repoOwner,
      repo: repoName,
      issue_number: issueNumber,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listIssueCommentsPageOrderedByIdAsc(
        repoOwner,
        repoName,
        issueNumber,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

async function listIssueCommentReactions(
  repoOwner: string,
  repoName: string,
  commentId: number,
): Promise<IssuesListReactionsResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: IssuesListReactionsResponseType;
  do {
    response = await listIssueCommentReactionsPage(
      repoOwner,
      repoName,
      commentId,
      pageNumber,
    );
    for (const arrayElement of response.data) {
      result.push(arrayElement as IssuesListReactionsResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length > 0);
  return result;
}

async function listIssueCommentReactionsPage(
  repoOwner: string,
  repoName: string,
  commentId: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<IssuesListReactionsResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.reactions.listForIssueComment({
      owner: repoOwner,
      repo: repoName,
      comment_id: commentId,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
        // no caching:
        "If-None-Match": "",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listIssueCommentReactionsPage(
        repoOwner,
        repoName,
        commentId,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

let lastGitHubCallUnixMillis = 0;

// should prevent throttling by GitHub
async function throttleGitHub() {
  // to be on a safe side target 0.7 RPS (it's 5000 requests per hour quota. Do preflight requests
  // count against the quota?):
  const millisSinceLastGitHubCall = Date.now() - lastGitHubCallUnixMillis;
  if (millisSinceLastGitHubCall < 1500) {
    const waitMs = 1500 - millisSinceLastGitHubCall;
    lastGitHubCallUnixMillis += 1500;
    await delay(waitMs);
  } else {
    lastGitHubCallUnixMillis = Date.now();
  }
  gitHubCallsCounter++;
}

export function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
