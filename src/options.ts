import '../styles/options.scss';
import { getRepos, getReposByFullName, Repo, storeGitHubUser, storeReposMap } from './storage';

const form = document.getElementById('repoForm');
const repoListDiv = document.getElementById('repoList');

showCurrentRepos();

async function showCurrentRepos() {
  getRepos()
      .then(repos => {
        const sortedRepos = repos.sort(function(a, b) {
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
      .catch(e => {
        console.error('Error fetching repositories from storage.', e);
      });
}

function addRepoCheckbox(repoFullname: string, enabled: boolean) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'reposCheckboxes';
  checkbox.id = repoFullname;
  checkbox.checked = enabled;

  checkbox.addEventListener('change', function(ignored) {
    updateReposToWatchFromCheckboxes();
  });

  const label = document.createElement('label');
  label.textContent = repoFullname;

  repoListDiv.appendChild(checkbox);
  repoListDiv.appendChild(label);
  const lineBreak = document.createElement('br');
  repoListDiv.appendChild(lineBreak);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const newRepoFullName = (document.getElementById('newRepo') as HTMLInputElement).value.trim();

  const re = new RegExp('/', 'g');
  if (newRepoFullName.match(re).length != 1) {
    return;
  }

  console.log("Evaluating adding " + newRepoFullName);
  if (document.getElementById(newRepoFullName) == undefined) {
    addRepoCheckbox(newRepoFullName, true);
    updateReposToWatchFromCheckboxes();
  }
});

document.getElementById('deleteToken')
    .addEventListener("click", function() {
      storeGitHubUser(null)
          .then(() => document.getElementById('main').innerHTML = "<h1>Click on the extension icon in the toolbar to enter a new token.</h1>");
    });

let updatingRepos = false;

async function updateReposToWatchFromCheckboxes() {
  // #NOT_MATURE: change this to real mutex, use CAS or lock:
  while (updatingRepos) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  updatingRepos = true;

  const reposByFullName = await getReposByFullName();
  const selectedCheckboxes = Array.from(
      document.querySelectorAll('input[name="reposCheckboxes"]'),
  ).map((e) => e as HTMLInputElement);

  selectedCheckboxes.forEach(checkBox => {
    const repo = reposByFullName.get(checkBox.id);
    if (repo) {
      repo.monitoringEnabled = checkBox.checked;
    } else {
      reposByFullName.set(checkBox.id, Repo.fromFullName(checkBox.id));
    }
  });
  storeReposMap(reposByFullName)
      .then(() => {
        console.log('Updated repos to watch:', selectedCheckboxes);
        updatingRepos = false;
      });
}