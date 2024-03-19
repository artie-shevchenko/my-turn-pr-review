import "../styles/options.scss";
import { RepoState } from "./repoState";
import { Repo } from "./repo";
import { SyncStatus } from "./github";
import { syncWithGitHub } from "./serviceWorker";
import {
  getGitHubUser,
  getRepos,
  getReposState,
  storeGitHubUser,
  storeNotMyTurnBlockList,
  storeReposMap,
  storeRepoStateMap,
} from "./storage";

const form = document.getElementById("repoForm");
const repoListDiv = document.getElementById("repoList");

showCurrentRepos();

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
        addRepoCheckbox(repo.fullName(), repo.monitoringEnabled);
      }
    })
    .catch((e) => {
      console.error("Error fetching repositories from storage.", e);
    });
}

function addRepoCheckbox(repoFullname: string, enabled: boolean) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "reposCheckboxes";
  checkbox.id = repoFullname;
  checkbox.checked = enabled;

  checkbox.addEventListener("change", () => {
    updateReposToWatchFromCheckboxes();
  });

  const label = document.createElement("label");
  label.textContent = repoFullname;

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

  const checkBoxes = Array.from(
    document.querySelectorAll('input[name="reposCheckboxes"]'),
  ).map((e) => e as HTMLInputElement);

  const reposByFullName = new Map<string, Repo>();
  checkBoxes.forEach((checkBox) => {
    reposByFullName.set(
      checkBox.id,
      Repo.fromFullName(checkBox.id, checkBox.checked),
    );
  });
  await storeReposMap(reposByFullName);
  console.log("Updated repos to watch:", checkBoxes);
  updatingRepos = false;

  const reposState = await getReposState();
  const syncStatus = await reposState.updateIcon();
  if (syncStatus === SyncStatus.Grey) {
    console.log("Triggering sync as there are new repos added.");
    getGitHubUser()
      .then((gitHubUser) => {
        syncWithGitHub(gitHubUser);
      })
      .catch((e) => {
        console.error("Sync failed", e);
      });
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const newRepoInput = document.getElementById("newRepo") as HTMLInputElement;
  const addRepoErrorDiv = document.getElementById(
    "addRepoError",
  ) as HTMLInputElement;
  const newRepoFullName = newRepoInput.value.trim();

  addRepoErrorDiv.style.display = "none";
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
  if (document.getElementById(newRepoFullName) == undefined) {
    addRepoCheckbox(newRepoFullName, true);
    updateReposToWatchFromCheckboxes();
    newRepoInput.value = "";
  } else {
    addRepoErrorDiv.style.display = "block";
    addRepoErrorDiv.innerHTML = "Repository already in the list.";
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
      .then(() => storeReposMap(new Map<string, Repo>()))
      .then(() => storeRepoStateMap(new Map<string, RepoState>()))
      .then(() => storeNotMyTurnBlockList([]))
      .then(() => {
        chrome.action.setIcon({
          path: "icons/grey128.png",
        });
      })
      .then(
        () =>
          (document.getElementById("main").innerHTML =
            "<h1>Click on the extension icon in the toolbar to enter a new token.</h1>"),
      );
  });
