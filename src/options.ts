import "../styles/options.scss";
import { Repo, RepoType } from "./repo";
import { SyncStatus } from "./reposState";
import { RepoState } from "./repoState";
import { Settings } from "./settings";
import {
  deleteSettings,
  getRepos,
  getReposState,
  getSettings,
  storeCommentBlockList,
  storeGitHubUser,
  storeMyPrBlockList,
  storeReposMap,
  storeRepoStateMap,
  storeSettings,
} from "./storage";
import { trySync } from "./sync";

const form = document.getElementById("repoForm");
const repoListDiv = document.getElementById("repoList");

showCurrentRepos();

showSettings();

async function showCurrentRepos() {
  getRepos()
    .then((repos) => {
      if (repos.length === 0) {
        document.getElementById("chooseGitHubRepo").style.display = "none";
        const addNewGitHubRepoToList = document.getElementById(
          "addNewGitHubRepoToList",
        );
        addNewGitHubRepoToList.innerHTML =
          "Add a GitHub repository to monitor:";
        addNewGitHubRepoToList.style.color = "yellow";
      }
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
        addGitHubRepoCheckbox(repo.fullName(), repo.monitoringEnabled);
      }
    })
    .catch((e) => {
      console.error("Error fetching repositories from storage.", e);
    });
}

function addGitHubRepoCheckbox(repoFullname: string, enabled: boolean) {
  document.getElementById("chooseGitHubRepo").style.display = "block";
  const addNewGitHubRepoToList = document.getElementById(
    "addNewGitHubRepoToList",
  );
  addNewGitHubRepoToList.innerHTML = "Add another GitHub repository:";
  addNewGitHubRepoToList.style.color = "white";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "gitHubReposCheckboxes";
  checkbox.id = repoFullname;
  checkbox.checked = enabled;

  checkbox.addEventListener("change", () => {
    updateReposToWatchFromCheckboxes();
  });

  const label = document.createElement("label") as HTMLLabelElement;
  label.textContent = " " + repoFullname;
  label.htmlFor = repoFullname;

  repoListDiv.appendChild(checkbox);
  repoListDiv.appendChild(label);
  const lineBreak = document.createElement("br");
  repoListDiv.appendChild(lineBreak);
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

  const reposByFullName = new Map<string, Repo>();
  gitHubCheckBoxes.forEach((checkBox) => {
    reposByFullName.set(
      checkBox.id,
      Repo.fromFullName(checkBox.id, RepoType.GITHUB, checkBox.checked),
    );
  });
  await storeReposMap(reposByFullName);
  console.log("Updated repos to watch:", gitHubCheckBoxes);
  updatingRepos = false;

  const reposState = await getReposState();
  const syncStatus = await reposState.updateIcon();
  if (syncStatus === SyncStatus.Grey) {
    console.log("Triggering sync as repo set / settings have changed.");
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
  const singleCommentIsReviewCheckbox = document.getElementById(
    "singleCommentIsReviewSetting",
  ) as HTMLInputElement;
  singleCommentIsReviewCheckbox.checked = settings.singleCommentIsReview;
  const ignoreCommentsMoreThanXDaysOldInput = document.getElementById(
    "ignoreCommentsMoreThanXDaysOldSetting",
  ) as HTMLInputElement;
  ignoreCommentsMoreThanXDaysOldInput.value =
    settings.ignoreCommentsMoreThanXDaysOld.toString();

  const storeUISettings = async () => {
    storeSettings(
      new Settings(
        ignoreMyPRsWithPendingReviewsCheckbox.checked,
        commentEqualsChangesRequestedCheckbox.checked,
        singleCommentIsReviewCheckbox.checked,
        ignoreCommentsMoreThanXDaysOldInput.value.trim().length === 0
          ? 0
          : Number.parseInt(ignoreCommentsMoreThanXDaysOldInput.value),
      ),
    );
  };
  ignoreMyPRsWithPendingReviewsCheckbox.addEventListener(
    "change",
    async function () {
      await storeUISettings();
      const reposState = await getReposState();
      await reposState.updateIcon();
    },
  );
  singleCommentIsReviewCheckbox.addEventListener("change", async function () {
    await storeUISettings();
    const reposState = await getReposState();
    await reposState.updateIcon();
  });
  commentEqualsChangesRequestedCheckbox.addEventListener(
    "change",
    async function () {
      await storeUISettings();
      const reposState = await getReposState();
      await reposState.updateIcon();
    },
  );
  ignoreCommentsMoreThanXDaysOldInput.addEventListener(
    "change",
    async function () {
      await storeUISettings();
      const reposState = await getReposState();
      await reposState.updateIcon();
      // Probably better not to trigger sync not to be throttled for GitHub notification API call.
      // There are some stricter secondary limits around notifications.
    },
  );
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const newRepoInput = document.getElementById("newRepo") as HTMLInputElement;
  const addRepoErrorDiv = document.getElementById(
    "addRepoError",
  ) as HTMLInputElement;
  const addRepoSuccessDiv = document.getElementById(
    "addRepoSuccess",
  ) as HTMLInputElement;
  const newRepoFullName = newRepoInput.value.trim();

  addRepoErrorDiv.style.display = "none";
  addRepoErrorDiv.innerHTML = "";

  const repoNameRegExp = new RegExp("/", "g");
  const regExpMatchArray = newRepoFullName.match(repoNameRegExp);
  if (!regExpMatchArray || regExpMatchArray.length != 1) {
    addRepoSuccessDiv.style.display = "none";
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Invalid repository name. Must contain exactly one '/'.";
    return;
  }

  console.log("Evaluating adding " + newRepoFullName);
  if (document.getElementById(newRepoFullName) == undefined) {
    addGitHubRepoCheckbox(newRepoFullName, true);
    updateReposToWatchFromCheckboxes();
    newRepoInput.value = "";
    addRepoSuccessDiv.style.display = "block";
  } else {
    addRepoSuccessDiv.style.display = "none";
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML =
      "Repository already present in the list above. Make sure the corresponding checkbox is checked.";
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
      .then(() => deleteSettings())
      .then(() => storeReposMap(new Map<string, Repo>()))
      .then(() => storeRepoStateMap(new Map<string, RepoState>()))
      .then(() => storeMyPrBlockList([]))
      .then(() => storeCommentBlockList([]))
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
