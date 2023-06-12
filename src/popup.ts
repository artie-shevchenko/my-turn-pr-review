import '../styles/popup.scss';
import { getGitHubUser, getRepos, GitHubUser, Repo, storeGitHubUser } from './storage';
import { Octokit } from "@octokit/rest";

document.getElementById('go-to-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('tokenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const newToken = document.getElementById('newToken').value.trim();
  new Octokit({
    auth: newToken,
  }).request('GET /user', {
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }).then(v => {
    const userId = v.data.id;
    console.log("GitHub user ID: " + userId);
    return storeGitHubUser(new GitHubUser(userId, newToken));
  }).then(() => {
    chrome.tabs.create({ active: true, url: "/options.html" });
    window.close();
  }).catch(e => {
    showError(e);
  });
});

class NoGitHubToken extends Error {
}

// TODO: add instructions for fine-grained GitHub tokens.
// TODO: show a warning if token has unnecessary permissions granted (is overly permissive).
// UPDATE: there is no way to get a list of token scopes. We could try making many different
// requests though...
getGitHubUser().then(gitHubUser => {
  if (gitHubUser && gitHubUser.token) {
    try {
      return new Octokit({
        auth: gitHubUser.token,
      }).request('GET /user', {
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch (e) {
      throw new Error("Could not get GitHub user. GitHub GET /user returned" + e);
    }
  } else {
    throw new NoGitHubToken();
  }
}).then(user => {
  if (user && user.data && user.data.id) {
    populate();
    document.getElementById('main').style.display = 'block';
  } else {
    throw new Error("Could not get GitHub user. GitHub GET /user returned: " + user);
  }
}).catch(e => {
  showError(e);
});

function showError(e: Error) {
  document.getElementById('auth').style.display = 'block';
  if (e instanceof NoGitHubToken) {
    // That's a part of the init flow, not an error.
  } else {
    const errorDiv = document.getElementById('error');
    errorDiv.style.display = 'block';
    errorDiv.innerHTML = "Something went wrong. If the error persists likely the GitHub auth token needs to be updated.<br/><br/>"
        + e;
  }
}


async function populate() {
  const repos: Repo[] = (await getRepos()).filter(r => r.lastSyncAttempted);

  const reposWithProblems = repos.filter(r => r.lastAttemptSuccess === false);
  const repoWarn = document.getElementById("repoWarn");
  if (reposWithProblems.length > 0) {
    repoWarn.innerHTML = "Attention! Couldn't sync with the following GitHub repos:<br/>" +
        reposWithProblems.map(r => {
          let message = r.fullName() + " - " + r.lastSyncError;
          if (r.lastSyncError.endsWith("Not Found")) {
            // TODO: test token expiration. We shouldn't end up here I believe.
            message += ' (likely problem is with token scopes or SSO configuration. Probably, go to the options page, delete token and start over again carefully following the instructions)';
          }
          return message;
        }).join(",<br/>");
  } else {
    repoWarn.innerHTML = "";
  }
  const repoList = document.getElementById("repoList");
  repoList.innerHTML = "Repos monitored: " +
      repos.filter(r => r.lastAttemptSuccess).map(r => r.fullName()).join(", ");

  const reviewsRequested = repos.flatMap(repo => {
    return repo.reviewsRequested.map(v => {
      v["repo"] = repo.owner + " / " + repo.name;
      return v;
    });
  }).sort((a, b) => a.firstTimeObservedUnixMillis - b.firstTimeObservedUnixMillis);

  const table = document.getElementById("prTable");

  // Iterate over the pullRequests array and create rows for each entry
  for (let i = 0; i < reviewsRequested.length; i++) {
    const row = table.insertRow(i + 1); // Insert rows starting from index 1

    const repoCell = row.insertCell(0);
    repoCell.innerHTML = reviewsRequested[i].repo;

    const prCell = row.insertCell(1);
    prCell.innerHTML = "<a href = '"
        + reviewsRequested[i].pr.url
        + "' target='_blank'>"
        + reviewsRequested[i].pr.name
        + "</a>";

    const hoursCell = row.insertCell(2);
    hoursCell.innerHTML = Math.floor((Date.now() - reviewsRequested[i].firstTimeObservedUnixMillis)
        / (1000 * 60 * 60)) + "h";

    // TODO: add silence review request button.
  }
}