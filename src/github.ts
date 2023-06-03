import { Octokit } from '@octokit/rest';
import { octokit } from './serviceWorker';
import {
  getGitHubUser,
  getRepos,
  getReposByFullName,
  PR,
  Repo,
  ReviewRequested, storeRepos,
} from './storage';

const PULLS_PER_PAGE = 100;

export async function listPullRequests(repo: Repo, pageNumber: number, retryNumber = 0) {
  try {
    return await octokit.pulls.list({
      owner: repo.owner,
      repo: repo.name,
      state: 'open',
      per_page: PULLS_PER_PAGE,
      page: pageNumber,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
        // no caching:
        'If-None-Match': '',
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

export async function haveOpenReviewRequest(gitHubUserId) {
  const reposByFullName = await getReposByFullName();
  let detectedRequestedReviews = false;
  // It's probably better to do these GitHub requests in a sequential manner so that GitHub is not
  // tempted to block them even if user monitors many repos:
  for (const [, repo] of reposByFullName) {
    if (!repo.monitoringEnabled) {
      repo.lastSyncAttempted = false;
      continue;
    }
    repo.lastSyncAttempted = true;
    // May be overridden later:
    repo.lastAttemptSuccess = true;
    try {
      let pullsList = [];
      let pageNumber = 1;
      let pullsListBatch = await listPullRequests(repo, pageNumber);
      while (pullsListBatch.data.length >= PULLS_PER_PAGE) {
        pullsList = pullsList.concat(pullsListBatch.data);
        pageNumber++;
        pullsListBatch = await listPullRequests(repo, pageNumber);
      }
      pullsList = pullsList.concat(pullsListBatch.data);

      console.log(`Total ${pullsList.length} PRs in: ${repo.fullName()}.`);

      const newReviewsRequested = [] as ReviewRequested[];
      pullsList.forEach((pr) => {
        pr.requested_reviewers.forEach(reviewer => {
          if (reviewer.id === gitHubUserId) {
            detectedRequestedReviews = true;
            const url = pr.html_url;
            const matchingReviewRequests = //
                repo.reviewsRequested.filter(existing => {
                  const existingUrl = existing.pr.url;
                  return (existingUrl === url);
                });
            // To have an up-to-date title:
            const pullRequest = new PR(url, pr.title);
            if (matchingReviewRequests.length == 0) {
              newReviewsRequested.push(new ReviewRequested(pullRequest, Date.now()));
            } else {
              const existingReviewRequest = matchingReviewRequests[0];
              newReviewsRequested.push(
                  new ReviewRequested(
                      pullRequest,
                      existingReviewRequest.firstTimeObservedUnixMillis,
                  ));
            }
          }
        });
      });
      // If review request was withdrawn and then re-requested again the first request will be
      // (correctly) ignored:
      repo.reviewsRequested = newReviewsRequested;
    } catch (e) {
      // Probably show a yellow icon? Or not.
      console.warn(`Error listing pull requests from ${repo.fullName()}. Ignoring it.`, e);
      repo.lastAttemptSuccess = false;
      repo.lastSyncError = e + "";
      if (repo.reviewsRequested.length > 0) {
        // Using the last sync results:
        detectedRequestedReviews = true;
      }
    }
  }

  // Maybe a list of repos was updated since the sync start:
  // TODO: maybe split a user-configurable list of repos from the repo sync result in storage.
  const reposFromStorage = await getRepos();
  for (const repoFromStorage of reposFromStorage) {
    const syncedRepo = reposByFullName.get(repoFromStorage.fullName());
    if (syncedRepo) {
      repoFromStorage.lastSyncAttempted = syncedRepo.lastSyncAttempted;
      repoFromStorage.lastAttemptSuccess = syncedRepo.lastAttemptSuccess;
      repoFromStorage.lastSyncError = syncedRepo.lastSyncError;
      repoFromStorage.reviewsRequested = syncedRepo.reviewsRequested;
    }
  }

  // Update in background:
  storeRepos(reposFromStorage);

  return detectedRequestedReviews;
}