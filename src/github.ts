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
import { ReasonNotIgnored, ReviewRequest } from "./reviewRequest";
import { ReviewState } from "./reviewState";
import { Settings } from "./settings";
import { octokit } from "./sync";

const MAX_NUMBER_OF_RETRIES = 3;

const ISSUE_COMMENTS_PER_PAGE = 100;
const ISSUE_COMMENT_REACTIONS_PER_PAGE = 100;
const ISSUE_EVENTS_PER_PAGE = 100;
const TEAMS_PER_PAGE = 100;
const NOTIFICATIONS_PER_PAGE = 50;
const PULL_COMMENTS_PER_PAGE = 100;
const PULL_COMMENT_REACTIONS_PER_PAGE = 100;
const PULLS_PER_PAGE = 100;
const REVIEWS_PER_PAGE = 100;
const REVIEW_COMMENTS_PER_PAGE = 100;

type PullsGetUserResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.users.getAuthenticated
>;
type TeamsListResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.teams.listForAuthenticatedUser
>;
type TeamsListResponseDataType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.teams.listForAuthenticatedUser
>;
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
type ListCommentsForReviewResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.pulls.listCommentsForReview
>;
type ListCommentsForReviewResponseDataType =
  GetResponseDataTypeFromEndpointMethod<
    typeof octokit.pulls.listCommentsForReview
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

  try {
    // Sync requests for my review:

    const myPRsToSyncBuilder = [] as PullsListResponseDataType[0][];
    repoSyncResult.requestsForMyReview = await syncRequestsForMyReview(
      repo,
      myGitHubUser,
      settings,
      myPRsToSyncBuilder,
    );
    const myPRsToSync = myPRsToSyncBuilder;

    // Sync my PRs:

    repoSyncResult.myPRs = [] as MyPR[];
    for (const pr of myPRsToSync) {
      const myPR = await syncMyPR(pr, repo);
      repoSyncResult.myPRs.push(myPR);
    }

    // Sync comments:

    repoSyncResult.comments = await syncComments(
      recentNotifications,
      myGitHubUser,
      settings,
    );

    repo.lastSuccessfulSyncResult = repoSyncResult;
    repo.lastSyncResult = repoSyncResult;
  } catch (e) {
    console.warn(`Error syncing ${repo.fullName}. Ignoring it.`, e);
    repoSyncResult.errorMsg = e + "";
    repo.lastSyncResult = repoSyncResult;
  }
}

async function syncRequestsForMyReview(
  repo: RepoState,
  myGitHubUser: GitHubUser,
  settings: Settings,
  myPRsToSyncBuilder: PullsListResponseDataType[0][],
) {
  const requestsForMyReviewBuilder = [] as ReviewRequest[];
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

        let myReviewRequested = false;
        for (const reviewer of pr.requested_reviewers) {
          if (reviewer.id === myGitHubUser.id) {
            const reviewRequestedAtUnixMillis =
              await getLatestReviewRequestedEventTimestamp(
                pr,
                repo,
                myGitHubUser.id,
              );
            const reviewRequest = new ReviewRequest(
              new PR(pr.html_url, pr.title, pr.draft),
              reviewRequestedAtUnixMillis,
            );
            requestsForMyReviewBuilder.push(reviewRequest);
            myReviewRequested = true;
          }
        }

        if (!myReviewRequested) {
          // Well, maybe my review was requested, but then I made a single comment and, voila, my
          // review is not requested anymore!

          if (!repo.lastSuccessfulSyncResult) {
            // sorry if that's the first sync for the repo, nothing we can do about it.
            continue;
          }

          if (
            repo.lastSuccessfulSyncResult.requestsForMyReview.filter(
              (r) => r.pr.url === pr.html_url,
            ).length == 0
          ) {
            continue;
          }
          // My review was requested at some point in the past. PR is open.
          // My review technically not requested anymore. Does it mean I left
          // a review? Maybe. Or I just left a single comment and that's being interpreted as a
          // review by GitHub. See https://github.com/artie-shevchenko/my-turn-pr-review/issues/52
          const reviewRequest = await maybeGetReviewRequest(
            pr,
            repo,
            myGitHubUser,
          );
          if (reviewRequest) {
            requestsForMyReviewBuilder.push(reviewRequest);
          }
        }

        let teamReviewRequest: ReviewRequest;
        for (const reviewerTeam of pr.requested_teams) {
          if (
            !myGitHubUser.teamIds.some((teamId) => teamId === reviewerTeam.id)
          ) {
            continue;
          }
          // deduplicate team review requests for the same PR:
          teamReviewRequest = new ReviewRequest(
            new PR(pr.html_url, pr.title, pr.draft),
            undefined,
            undefined,
            reviewerTeam.name,
          );
        }
        if (teamReviewRequest) {
          requestsForMyReviewBuilder.push(teamReviewRequest);
        }
      }
    }
    pageNumber++;
  } while (pullsListResponse.data.length >= PULLS_PER_PAGE);
  return requestsForMyReviewBuilder;
}

async function getLatestReviewRequestedEventTimestamp(
  pr: PullsListResponseDataType[0],
  repo: RepoState,
  reviewerId: number,
): Promise<number> {
  let result = 0;
  const events = await listIssueEvents(repo, pr.number);
  for (const event of events) {
    if (
      event.event === "review_requested" &&
      event.requested_reviewer.id === reviewerId
    ) {
      result = Math.max(result, new Date(event.created_at).getTime());
    }
  }
  return result;
}

/** Returns a review request if I left no real review, just "Add a single comment" maybe. */
async function maybeGetReviewRequest(
  pr: PullsListResponseDataType[0],
  repo: RepoState,
  myGitHubUser: GitHubUser,
) {
  const lastMyReviewRequestedUnixMillis =
    await getLatestReviewRequestedEventTimestamp(pr, repo, myGitHubUser.id);

  const reviewsAfterMyLastReviewRequested = (
    await listReviews(repo, pr.number)
  ).filter(
    (v) => new Date(v.submitted_at).getTime() > lastMyReviewRequestedUnixMillis,
  );

  for (const review of reviewsAfterMyLastReviewRequested) {
    if (review.user.id !== myGitHubUser.id) {
      continue;
    }

    if (review.body.length > 0 || review.state !== "COMMENTED") {
      // That's a real review, not "Add a single comment".
      return undefined;
    }

    const comments = await listCommentsForReview(repo, pr.number, review.id);
    if (comments.length !== 1) {
      // That's a real review, not "Add a single comment".
      return undefined;
    }
  }

  // I left no real reviews after review requested, just "Add a single comment" "reviews" (or a
  // review that is indistinguishable from it.
  return new ReviewRequest(
    new PR(pr.html_url, pr.title, pr.draft),
    lastMyReviewRequestedUnixMillis,
    ReasonNotIgnored.LIKELY_JUST_SINGLE_COMMENT,
  );
}

async function syncMyPR(pr: PullsListResponseDataType[0], repo: RepoState) {
  const reviewsRequested = pr.requested_reviewers.map((reviewer) => {
    const pullRequest = new PR(pr.html_url, pr.title, pr.draft);
    return new ReviewRequestOnMyPR(pullRequest, reviewer.id);
  });

  // Now query reviews already received:
  const reviews: PullsListReviewsResponseDataType = await listReviews(
    repo,
    pr.number,
  );

  const prObj = new PR(pr.html_url, pr.title, pr.draft);
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

async function syncComments(
  recentNotifications: ListNotificationsResponseDataType[0][],
  myGitHubUser: GitHubUser,
  settings: Settings,
) {
  const commentsBuilder = [] as Comment[];
  for (const notification of recentNotifications) {
    if (notification.subject.type !== "PullRequest") {
      continue;
    }
    await syncPullComments(
      notification,
      myGitHubUser,
      settings,
      commentsBuilder,
    );
    await syncIssueComments(
      notification,
      myGitHubUser,
      settings,
      commentsBuilder,
    );
  }
  return commentsBuilder;
}

async function syncPullComments(
  notification: ListNotificationsResponseDataType[0],
  myGitHubUser: GitHubUser,
  settings: Settings,
  commentsBuilder: Comment[],
) {
  const prUrl = notification.subject.url;
  const prNumber = Number.parseInt(prUrl.substring(prUrl.lastIndexOf("/") + 1));
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

      if (new Date(comment.created_at) < settings.getMinCommentCreateDate()) {
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
}

async function syncIssueComments(
  notification: ListNotificationsResponseDataType[0],
  myGitHubUser: GitHubUser,
  settings: Settings,
  commentsBuilder: Comment[],
) {
  const prUrl = notification.subject.url;
  const prNumber = Number.parseInt(prUrl.substring(prUrl.lastIndexOf("/") + 1));
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

export async function listReviews(
  repo: RepoState,
  pullNumber: number,
): Promise<PullsListReviewsResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: PullsListReviewsResponseType;
  do {
    response = await listReviewsPage(repo, pullNumber, pageNumber);
    for (const arrayElement of response.data) {
      result.push(arrayElement as PullsListReviewsResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length >= REVIEWS_PER_PAGE);
  return result;
}

async function listReviewsPage(
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
      per_page: REVIEWS_PER_PAGE,
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
      return await listReviewsPage(
        repo,
        pullNumber,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

export async function listCommentsForReview(
  repo: RepoState,
  pullNumber: number,
  reviewId: number,
): Promise<ListCommentsForReviewResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: ListCommentsForReviewResponseType;
  do {
    response = await listCommentsForReviewPage(
      repo,
      pullNumber,
      reviewId,
      pageNumber,
    );
    for (const arrayElement of response.data) {
      result.push(arrayElement as ListCommentsForReviewResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length >= REVIEW_COMMENTS_PER_PAGE);
  return result;
}

async function listCommentsForReviewPage(
  repo: RepoState,
  pullNumber: number,
  reviewId: number,
  pageNumber: number,
  retryNumber = 0,
): Promise<ListCommentsForReviewResponseType> {
  try {
    // A little hack just to get repo owner and name:
    const r = Repo.fromFullName(repo.fullName, RepoType.GITHUB);
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.pulls.listCommentsForReview({
      owner: r.owner,
      repo: r.name,
      pull_number: pullNumber,
      review_id: reviewId,
      per_page: REVIEW_COMMENTS_PER_PAGE,
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
      return await listCommentsForReviewPage(
        repo,
        pullNumber,
        reviewId,
        pageNumber,
        retryNumber + 1,
      );
    }
  }
}

export async function listIssueEvents(
  repo: RepoState,
  pullNumber: number,
): Promise<IssuesListEventsResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: IssuesListEventsResponseType;
  do {
    response = await listIssueEventsPage(repo, pullNumber, pageNumber);
    for (const arrayElement of response.data) {
      result.push(arrayElement as IssuesListEventsResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length >= ISSUE_EVENTS_PER_PAGE);
  return result;
}

async function listIssueEventsPage(
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
      per_page: ISSUE_EVENTS_PER_PAGE,
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
      return await listIssueEventsPage(
        repo,
        pullNumber,
        pageNumber,
        retryNumber + 1,
      );
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
  } while (response.data.length >= NOTIFICATIONS_PER_PAGE);
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
      per_page: NOTIFICATIONS_PER_PAGE,
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
  } while (response.data.length >= PULL_COMMENTS_PER_PAGE);

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
      per_page: PULL_COMMENTS_PER_PAGE,
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
  } while (response.data.length >= PULL_COMMENT_REACTIONS_PER_PAGE);
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
      per_page: PULL_COMMENT_REACTIONS_PER_PAGE,
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
  } while (response.data.length >= ISSUE_COMMENTS_PER_PAGE);

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
      per_page: ISSUE_COMMENTS_PER_PAGE,
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
  } while (response.data.length >= ISSUE_COMMENT_REACTIONS_PER_PAGE);
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
      per_page: ISSUE_COMMENT_REACTIONS_PER_PAGE,
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

export async function getUser(
  retryNumber = 0,
): Promise<PullsGetUserResponseType> {
  try {
    // A little hack just to get repo owner and name:
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.users.getAuthenticated({
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await getUser(retryNumber + 1);
    }
  }
}

export async function listUserTeams(): Promise<TeamsListResponseDataType[0][]> {
  const result = [];
  let pageNumber = 1;
  let response: TeamsListResponseType;
  do {
    response = await listUserTeamsPage(pageNumber);
    for (const arrayElement of response.data) {
      result.push(arrayElement as TeamsListResponseDataType[0]);
    }
    pageNumber++;
  } while (response.data.length >= TEAMS_PER_PAGE);
  return result;
}

async function listUserTeamsPage(
  pageNumber: number,
  retryNumber = 0,
): Promise<TeamsListResponseType> {
  try {
    if (retryNumber > 0) {
      // exponential backoff:
      await delay(1000 * Math.pow(2, retryNumber - 1));
    }
    await throttleGitHub();
    return await octokit.teams.listForAuthenticatedUser({
      per_page: ISSUE_EVENTS_PER_PAGE,
      page: pageNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    if (retryNumber > MAX_NUMBER_OF_RETRIES) {
      console.error("The maximum number of retries reached");
      throw e;
    } else {
      return await listUserTeamsPage(pageNumber, retryNumber + 1);
    }
  }
}

let lastGitHubCallUnixMillis = 0;

// should prevent throttling by GitHub
async function throttleGitHub() {
  // to be on a safe side target 1 RPS (it's 5000 requests per hour quota. Hopefully preflight
  // requests don't count against the quota?):
  const millisSinceLastGitHubCall = Date.now() - lastGitHubCallUnixMillis;
  if (millisSinceLastGitHubCall < 1000) {
    const waitMs = 1000 - millisSinceLastGitHubCall;
    lastGitHubCallUnixMillis += 1000;
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
