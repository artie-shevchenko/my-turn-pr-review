import "../styles/options.scss";
import { Repo, RepoType } from "./repo";
import { SyncStatus } from "./reposState";
import { Settings } from "./settings";
import {
  deleteSettings,
  getRepos,
  getReposState,
  getSettings,
  storeGitHubUser,
  storeGitLabUser,
  storeNotMyTurnBlockList,
  storeReposList,
  storeRepoStateList,
  storeSettings,
} from "./storage";
import { trySync } from "./sync";

// TODO(29): hide gitHubRepoForm/gitLabRepoForm if there is no corresponding token
const gitHubRepoForm = document.getElementById("gitHubRepoForm");
const gitHubRepoListDiv = document.getElementById("gitHubRepoList");
const gitLabRepoForm = document.getElementById("gitLabRepoForm");
const gitLabRepoListDiv = document.getElementById("gitLabRepoList");

showCurrentRepos();

showSettings();

async function showCurrentRepos() {
  getRepos()
    .then((repos) => {
      const sortedRepos = repos.sort(function (a, b) {
        if (a.fullName() < b.fullName()) {
          return -1;
        }
        if (a.fullName() > b.fullName()) {
          return 1;
        }
        return 0;
      });
      for (const repo of sortedRepos) {
        if (repo.type === RepoType.GITHUB) {
          addGitHubRepoCheckbox(repo.fullName(), repo.monitoringEnabled);
        } else if (repo.type === RepoType.GITLAB) {
          addGitLabRepoCheckbox(repo.fullName(), repo.monitoringEnabled);
        }
      }
    })
    .catch((e) => {
      console.error("Error fetching repositories from storage.", e);
    });
}

function addGitHubRepoCheckbox(repoFullname: string, enabled: boolean) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "gitHubReposCheckboxes";
  checkbox.id = "gitHub:" + repoFullname;
  checkbox.checked = enabled;

  checkbox.addEventListener("change", () => {
    updateReposToWatchFromCheckboxes();
  });

  const label = document.createElement("label") as HTMLLabelElement;
  label.textContent = " " + repoFullname;
  label.htmlFor = checkbox.id;

  gitHubRepoListDiv.appendChild(checkbox);
  gitHubRepoListDiv.appendChild(label);
  const lineBreak = document.createElement("br");
  gitHubRepoListDiv.appendChild(lineBreak);
}

function addGitLabRepoCheckbox(repoFullname: string, enabled: boolean) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "gitLabReposCheckboxes";
  checkbox.id = "gitLab:" + repoFullname;
  checkbox.checked = enabled;

  checkbox.addEventListener("change", () => {
    updateReposToWatchFromCheckboxes();
  });

  const label = document.createElement("label") as HTMLLabelElement;
  label.textContent = " " + repoFullname;
  label.htmlFor = checkbox.id;

  gitLabRepoListDiv.appendChild(checkbox);
  gitLabRepoListDiv.appendChild(label);
  const lineBreak = document.createElement("br");
  gitLabRepoListDiv.appendChild(lineBreak);
}

let updatingRepos = false;

async function updateReposToWatchFromCheckboxes() {
  // #NOT_MATURE: change this to real mutex, use CAS or lock:
  while (updatingRepos) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  updatingRepos = true;

  const gitHubCheckBoxes = Array.from(
    document.querySelectorAll('input[name="gitHubReposCheckboxes"]'),
  ).map((e) => e as HTMLInputElement);
  const gitLabCheckBoxes = Array.from(
    document.querySelectorAll('input[name="gitLabReposCheckboxes"]'),
  ).map((e) => e as HTMLInputElement);

  const repoList = [] as Repo[];
  gitHubCheckBoxes.forEach((checkBox) => {
    // #NOT_MATURE
    const fullName = checkBox.id.substring("github:".length);
    repoList.push(
      Repo.fromFullName(fullName, RepoType.GITHUB, checkBox.checked),
    );
  });
  gitLabCheckBoxes.forEach((checkBox) => {
    // #NOT_MATURE
    const fullName = checkBox.id.substring("gitlab:".length);
    repoList.push(
      Repo.fromFullName(fullName, RepoType.GITLAB, checkBox.checked),
    );
  });
  await storeReposList(repoList);
  console.log("Updated repos to watch.");
  updatingRepos = false;

  const reposState = await getReposState();
  const syncStatus = await reposState.updateIcon();
  if (syncStatus === SyncStatus.Grey) {
    console.log("Triggering sync as there are new repos added.");
    trySync();
  }
}

async function showSettings() {
  const settings = await getSettings();
  const ignoreMyPRsWithPendingReviewsCheckbox = document.getElementById(
    "ignoreMyPRsWithPendingReviewRequests",
  ) as HTMLInputElement;
  ignoreMyPRsWithPendingReviewsCheckbox.checked =
    settings.noPendingReviewsToBeMergeReady;
  const commentEqualsChangesRequestedCheckbox = document.getElementById(
    "commentEqualsChangesRequestedSetting",
  ) as HTMLInputElement;
  commentEqualsChangesRequestedCheckbox.checked =
    settings.commentEqualsChangesRequested;

  const triggerStoreSettings = () => {
    storeSettings(
      new Settings(
        ignoreMyPRsWithPendingReviewsCheckbox.checked,
        commentEqualsChangesRequestedCheckbox.checked,
      ),
    );
  };
  ignoreMyPRsWithPendingReviewsCheckbox.addEventListener(
    "change",
    triggerStoreSettings,
  );
  commentEqualsChangesRequestedCheckbox.addEventListener(
    "change",
    triggerStoreSettings,
  );
}

gitHubRepoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const newRepoInput = document.getElementById(
    "newGitHubRepo",
  ) as HTMLInputElement;
  const addRepoErrorDiv = document.getElementById(
    "addGitHubRepoError",
  ) as HTMLInputElement;
  const addRepoSuccessDiv = document.getElementById(
    "addGitHubRepoSuccess",
  ) as HTMLInputElement;
  const newRepoFullName = newRepoInput.value.trim();

  addRepoErrorDiv.style.display = "none";
  addRepoSuccessDiv.style.display = "none";
  addRepoErrorDiv.innerHTML = "";

  const repoNameRegExp = new RegExp("/", "g");
  const regExpMatchArray = newRepoFullName.match(repoNameRegExp);
  if (!regExpMatchArray || regExpMatchArray.length != 1) {
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Invalid repository name. Must contain exactly one '/'.";
    return;
  }

  console.log("Evaluating adding " + newRepoFullName);
  if (!document.getElementById("gitHub:" + newRepoFullName)) {
    addGitHubRepoCheckbox(newRepoFullName, true);
    updateReposToWatchFromCheckboxes();
    newRepoInput.value = "";
    addRepoSuccessDiv.style.display = "block";
  } else {
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Repository already present in the list above. Make sure it's checked.";
    return;
  }
});

gitLabRepoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const newRepoInput = document.getElementById(
    "newGitLabRepo",
  ) as HTMLInputElement;
  const addRepoErrorDiv = document.getElementById(
    "addGitLabRepoError",
  ) as HTMLInputElement;
  const addRepoSuccessDiv = document.getElementById(
    "addGitLabRepoSuccess",
  ) as HTMLInputElement;
  const newRepoFullName = newRepoInput.value.trim();

  addRepoErrorDiv.style.display = "none";
  addRepoSuccessDiv.style.display = "none";
  addRepoErrorDiv.innerHTML = "";

  const repoNameRegExp = new RegExp("/", "g");
  const regExpMatchArray = newRepoFullName.match(repoNameRegExp);
  if (!regExpMatchArray || regExpMatchArray.length != 1) {
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Invalid repository name. Must contain exactly one '/'.";
    return;
  }

  console.log("Evaluating adding " + newRepoFullName);
  if (!document.getElementById("gitLab:" + newRepoFullName)) {
    addGitLabRepoCheckbox(newRepoFullName, true);
    updateReposToWatchFromCheckboxes();
    newRepoInput.value = "";
    addRepoSuccessDiv.style.display = "block";
  } else {
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Repository already present in the list above. Make sure it's checked.";
    return;
  }
});

document
  .getElementById("factoryResetButton")
  .addEventListener("click", function () {
    if (
      !confirm(
        "This will clear all the 'My Turn' extension's data. Are you sure you want to proceed?",
      )
    ) {
      return;
    }

    // #NOT_MATURE: use Promise.all instead:
    storeGitHubUser(null)
      .then(() => storeGitLabUser(null))
      .then(() => deleteSettings())
      .then(() => storeReposList([]))
      .then(() => storeRepoStateList([]))
      .then(() => storeNotMyTurnBlockList([]))
      .then(() => {
        chrome.action.setIcon({
          path: "icons/grey128.png",
        });
      })
      .then(
        () =>
          (document.getElementById("main").innerHTML =
            "<h1>Click on the extension icon in the toolbar to add a new token.</h1>"),
      );
  });
