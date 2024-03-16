import "../styles/popup.scss";
import { Octokit } from "@octokit/rest";
import { syncWithGitHub } from "./serviceWorker";
import {
  getGitHubUser,
  getMonitoringEnabledRepos,
  getRepoStateByFullName,
  GitHubUser,
  MyPRReviewStatus,
  Repo,
  RepoState,
  ReviewState,
  storeGitHubUser,
} from "./storage";

document.getElementById("go-to-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("tokenForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const newToken = (
    document.getElementById("newToken") as HTMLInputElement
  ).value.trim();
  new Octokit({
    auth: newToken,
  })
    .request("GET /user", {
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((v) => {
      const userId = v.data.id;
      console.log("GitHub user ID: " + userId);
      const gitHubUser = new GitHubUser(userId, newToken);
      const result = storeGitHubUser(gitHubUser);
      // trigger sync:
      syncWithGitHub(gitHubUser);
      return result;
    })
    .then(() => {
      chrome.tabs.create({ active: true, url: "/options.html" });
      window.close();
    })
    .catch((e) => {
      showError(e);
    });
});

class NoGitHubToken extends Error {}

// TODO(6): add instructions for fine-grained GitHub tokens.
getGitHubUser()
  .then((gitHubUser) => {
    if (gitHubUser && gitHubUser.token) {
      try {
        return new Octokit({
          auth: gitHubUser.token,
        }).request("GET /user", {
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
      } catch (e) {
        throw new Error(
          "Could not get GitHub user. GitHub GET /user returned" + e,
        );
      }
    } else {
      throw new NoGitHubToken();
    }
  })
  .then((user) => {
    if (user && user.data && user.data.id) {
      populate();
      document.getElementById("main").style.display = "block";

      setInterval(function () {
        populate();
      }, 60000);
    } else {
      throw new Error(
        "Could not get GitHub user. GitHub GET /user returned: " + user,
      );
    }
  })
  .catch((e) => {
    showError(e);
  });

const BAD_CREDENTIALS_GITHUB_ERROR_MSG = "Bad credentials";

function showError(e: Error) {
  document.getElementById("auth").style.display = "block";
  if (e instanceof NoGitHubToken) {
    // That's a part of the init flow, not an error.
    document.getElementById("setup").style.display = "block";
  } else {
    const errorDiv = document.getElementById("error");
    errorDiv.style.display = "block";
    if (e.message === BAD_CREDENTIALS_GITHUB_ERROR_MSG) {
      errorDiv.innerHTML =
        "Error: Bad GitHub credentials. Likely the GitHub access token expired and needs to be updated. Follow the instructions below.<br/><br/>";
    } else {
      errorDiv.innerHTML =
        "Something went wrong. If the error persists it may be a problem with GitHub auth token.<br/><br/>" +
        e;
    }
  }
}

async function populate() {
  const repoStateByFullName = await getRepoStateByFullName();
  const repos: Repo[] = await getMonitoringEnabledRepos();
  const syncSuccessRepos = repos
    .filter((r) => {
      const repoState = repoStateByFullName.get(r.fullName());
      if (!repoState) {
        return false;
      }
      return (
        repoState.hasRecentSuccessfulSync() ||
        // chrome just restarted
        (repoState.lastSuccessfulSyncResult &&
          repoState.lastSuccessfulSyncResult.syncStartUnixMillis ==
            repoState.lastSyncResult.syncStartUnixMillis)
      );
    })
    .map((r) => repoStateByFullName.get(r.fullName()));
  const syncFailureRepos = repos
    .filter((r) => {
      const repoState = repoStateByFullName.get(r.fullName());
      if (!repoState) {
        return false;
      }
      if (syncSuccessRepos.some((v) => v.fullName === r.fullName())) {
        return false;
      }
      // #NOT_MATURE: is the following always true?
      return repoState.lastSyncResult.errorMsg;
    })
    .map((r) => repoStateByFullName.get(r.fullName()));
  const unsyncedRepos = repos.filter((r) => {
    return (
      !syncSuccessRepos.some((v) => v.fullName === r.fullName()) &&
      !syncFailureRepos.some((v) => v.fullName === r.fullName())
    );
  });

  populateFromState(syncSuccessRepos, syncFailureRepos, unsyncedRepos);
}

const REVIEW_REQUSTED_SVG =
  '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">\n' +
  '    <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" fill="#9a6700"></path>\n' +
  "</svg>";

const COMMENTED_SVG =
  '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">\n' +
  '    <path fill="#656d76" d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>\n' +
  "</svg>";

const CHANGES_REQUSTED_SVG =
  '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">\n' +
  '    <path fill="#656d76" d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path>\n' +
  "</svg>";

const APPROVED_SVG =
  '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">\n' +
  '    <path fill="#1a7f37" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>\n' +
  "</svg>";

const SYNC_IN_PROGRESS_MSG = "Sync with GitHub in progress...";

async function populateFromState(
  syncSuccessRepos: RepoState[],
  syncFailureRepos: RepoState[],
  unsyncedRepos: Repo[],
) {
  const repoWarnSection = document.getElementById("repoWarn");
  let badCredentialsErrorsOnly = false;
  if (syncFailureRepos.length > 0) {
    badCredentialsErrorsOnly = syncFailureRepos
      .map((repo) => {
        return repo.lastSyncResult.errorMsg;
      })
      .every((msg) => msg.endsWith(BAD_CREDENTIALS_GITHUB_ERROR_MSG));
    if (badCredentialsErrorsOnly) {
      repoWarnSection.innerHTML = SYNC_IN_PROGRESS_MSG;
    } else {
      repoWarnSection.innerHTML =
        "Attention! Couldn't sync with the following GitHub repos:<br/>" +
        syncFailureRepos
          .map((repo) => {
            const lastSyncErrorMsg = repo.lastSyncResult.errorMsg;
            let message = repo.fullName + " - " + lastSyncErrorMsg;
            if (
              lastSyncErrorMsg.includes(
                "You must grant your Personal Access token access to this organization",
              )
            ) {
              message +=
                ' <a href="https://github.com/settings/tokens" target="_blank">Configure SSO (authorize the access token)</a>.';
            }
            return message;
          })
          .join(",<br/>");
    }
  } else {
    repoWarnSection.innerHTML = "";
  }

  const minSuccessSyncStartUnixMillis = Math.min(
    ...syncSuccessRepos.map(
      (r) => r.lastSuccessfulSyncResult.syncStartUnixMillis,
    ),
  );

  const repoListSection = document.getElementById("repoList");
  if (
    minSuccessSyncStartUnixMillis &&
    minSuccessSyncStartUnixMillis != Infinity
  ) {
    repoListSection.innerHTML =
      "Last sync with GitHub: " +
      new Date(minSuccessSyncStartUnixMillis).toLocaleString() +
      ".<br/>Repos monitored: " +
      syncSuccessRepos
        .map((repo) => repo.fullName)
        .sort()
        .join(", ") +
      ".";
  } else {
    if (unsyncedRepos.length > 0 || syncFailureRepos.length > 0) {
      repoListSection.innerHTML = "No recent successful syncs with GitHub yet.";
      if (!badCredentialsErrorsOnly) {
        repoListSection.innerHTML += " " + SYNC_IN_PROGRESS_MSG;
      }
    } else {
      repoListSection.innerHTML =
        "No repos being monitored. Click 'Settings...' to add GitHub repositories.";
    }
  }
  if (unsyncedRepos.length > 0) {
    repoListSection.innerHTML =
      repoListSection.innerHTML +
      "<br/>First sync is in progress for repos: " +
      unsyncedRepos
        .map((repo) => repo.fullName())
        .sort()
        .join(", ") +
      ".";
  }

  const requestsForMyReviews = syncSuccessRepos
    .flatMap((repo) => {
      return repo.lastSuccessfulSyncResult.requestsForMyReview.map((v) => {
        v.repoFullName = repo.fullName;
        return v;
      });
    })
    .sort(
      (a, b) => a.firstTimeObservedUnixMillis - b.firstTimeObservedUnixMillis,
    );

  const myPRs = syncSuccessRepos.flatMap((repo) => {
    return repo.lastSuccessfulSyncResult.myPRs.map((v) => {
      v.repoFullName = repo.fullName;
      return v;
    });
  });

  const reviewRequestedTable = document.getElementById(
    "prTable",
  ) as HTMLTableElement;
  deleteAllRows(reviewRequestedTable);
  const myPRsTable = document.getElementById("myPrTable") as HTMLTableElement;
  deleteAllRows(myPRsTable);

  // Iterate over the requestsForMyReviews array and create rows for each entry
  for (let i = 0; i < requestsForMyReviews.length; i++) {
    const row = reviewRequestedTable.insertRow(i + 1); // Insert rows starting from index 1

    const repoCell = row.insertCell(0);
    repoCell.innerHTML = requestsForMyReviews[i].repoFullName;

    const prCell = row.insertCell(1);
    prCell.innerHTML =
      "<a href = '" +
      requestsForMyReviews[i].pr.url +
      "' target='_blank'>" +
      requestsForMyReviews[i].pr.name +
      "</a>";

    const hoursCell = row.insertCell(2);
    hoursCell.innerHTML =
      Math.floor(
        (Date.now() - requestsForMyReviews[i].firstTimeObservedUnixMillis) /
          (1000 * 60 * 60),
      ) + "h";

    // TODO(9): add silence review request button.
  }

  // Iterate over the myPRs array and create rows for each entry
  for (let i = 0, rowIndex = 0; i < myPRs.length; i++) {
    const myPR = myPRs[i];
    if (myPR.getStatus() === MyPRReviewStatus.NONE) {
      continue;
    }
    rowIndex++;

    const row = myPRsTable.insertRow(rowIndex); // Insert rows starting from index 1

    const repoCell = row.insertCell(0);
    repoCell.innerHTML = myPR.repoFullName;

    const prCell = row.insertCell(1);
    prCell.innerHTML =
      "<a href = '" +
      myPR.pr.url +
      "' target='_blank'>" +
      myPR.pr.name +
      "</a>";

    const statusCell = row.insertCell(2);

    let hasReviewRequested = false;
    let hasCommented = false;
    let hasChangesRequested = false;
    let hasApproved = false;
    myPR.reviewerStates.forEach((reviewerState) => {
      if (reviewerState.state === ReviewState.REQUESTED) {
        hasReviewRequested = true;
      } else if (reviewerState.state === ReviewState.COMMENTED) {
        hasCommented = true;
      } else if (reviewerState.state === ReviewState.CHANGES_REQUESTED) {
        hasChangesRequested = true;
      } else if (reviewerState.state === ReviewState.APPROVED) {
        hasApproved = true;
      }
    });

    statusCell.innerHTML = "";

    if (hasApproved) {
      statusCell.innerHTML += APPROVED_SVG;
    }
    if (hasCommented) {
      statusCell.innerHTML += COMMENTED_SVG;
    }
    if (hasChangesRequested) {
      statusCell.innerHTML += CHANGES_REQUSTED_SVG;
    }
    if (hasReviewRequested) {
      statusCell.innerHTML += REVIEW_REQUSTED_SVG;
    }
  }

  function deleteAllRows(htmlTableElement: HTMLTableElement) {
    while (htmlTableElement.rows.length > 1) {
      htmlTableElement.deleteRow(1);
    }
  }
}
