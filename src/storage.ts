import { getBucket } from "@extend-chrome/storage";
import { GitLabUser } from "./gitLabUser";
import { ReposState } from "./reposState";
import { Settings } from "./settings";
import { GitHubUser } from "./gitHubUser";
import { NotMyTurnBlock } from "./notMyTurnBlock";
import { Repo } from "./repo";
import { RepoState } from "./repoState";

const REPO_STORE_KEY = "reposStore";
const REPO_STATE_LIST_STORE_KEY = "repoStateListStore";

// Repo storage:

class RepoList {
  repos: Repo[];

  constructor(repos: Repo[]) {
    this.repos = repos;
  }
}

export async function storeReposList(repos: Repo[]): Promise<RepoList> {
  console.log("Storing repos");
  return getBucket<RepoList>(REPO_STORE_KEY, "sync").set(new RepoList(repos));
}

export async function getMonitoringEnabledRepos(): Promise<Repo[]> {
  return getRepos().then((repos) => {
    return repos.filter((repo) => repo.monitoringEnabled);
  });
}

export async function getRepos(): Promise<Repo[]> {
  return (
    getBucket<RepoList>(REPO_STORE_KEY, "sync")
      .get()
      // storage returns an Object, not a Repo...
      .then((l) => (l && l.repos ? l.repos.map((v) => Repo.of(v)) : []))
  );
}

// RepoState storage:

class RepoStateList {
  repoStateList: RepoState[];

  constructor(repos: RepoState[]) {
    this.repoStateList = repos;
  }
}

export async function storeRepoStateList(repoStateList: RepoState[]) {
  return getBucket<RepoStateList>(REPO_STATE_LIST_STORE_KEY, "local").set(
    new RepoStateList(repoStateList),
  );
}

export async function getReposState(): Promise<ReposState> {
  return getRepoStateList().then((repoStateList) => {
    return new ReposState(repoStateList);
  });
}

export async function getRepoStateList(): Promise<RepoState[]> {
  return (
    getBucket<RepoStateList>(REPO_STATE_LIST_STORE_KEY, "local")
      .get()
      // storage returns an Object, not a Repo...
      .then((l) => {
        return l && l.repoStateList
          ? l.repoStateList.map((v) => RepoState.of(v))
          : [];
      })
  );
}

// GitHubUser storage:

export async function storeGitHubUser(user: GitHubUser) {
  const store = getBucket<GitHubUser>("gitHubUser", "sync");
  if (!user) {
    return store.clear();
  }
  return store.set(user);
}

export async function getGitHubUser(): Promise<GitHubUser> {
  const store = getBucket<GitHubUser>("gitHubUser", "sync");
  return store.get();
}

// GitLabUser storage:

export async function storeGitLabUser(user: GitLabUser) {
  const store = getBucket<GitLabUser>("gitLabUser", "sync");
  if (!user) {
    return store.clear();
  }
  return store.set(user);
}

export async function getGitLabUser(): Promise<GitLabUser> {
  const store = getBucket<GitLabUser>("gitLabUser", "sync");
  return store.get();
}

// Settings storage:

export async function storeSettings(settings: Settings) {
  const store = getBucket<Settings>("settings", "sync");
  return store.set(settings);
}

export async function deleteSettings() {
  const store = getBucket<Settings>("settings", "sync");
  return store.clear();
}

export async function getSettings(): Promise<Settings> {
  const store = getBucket<Settings>("settings", "sync");
  return (
    store
      .get()
      // storage returns an Object, not Settings...
      .then((stored) => {
        // looks like if(!stored) does something fancy in JS for objects with a boolean
        // property...
        return stored === undefined
          ? new Settings(
              /* noPendingReviewsToBeMergeReady = */ false,
              /* commentEqualsChangesRequested = */ false,
            )
          : new Settings(
              stored.noPendingReviewsToBeMergeReady !== undefined
                ? stored.noPendingReviewsToBeMergeReady
                : false,
              stored.commentEqualsChangesRequested !== undefined
                ? stored.commentEqualsChangesRequested
                : true,
            );
      })
  );
}

// NotMyTurnBlock storage:

class NotMyTurnBlockList {
  notMyTurnBlockList: NotMyTurnBlock[];

  constructor(notMyTurnBlockList: NotMyTurnBlock[]) {
    this.notMyTurnBlockList = notMyTurnBlockList;
  }
}

const NOT_MY_TURN_BLOCK_LIST_KEY_BASE = "notMyTurnBlockList";
const MAX_ITEM_BYTES_IN_SYNC_STORAGE = 8000 / 2; // to be on a safe side

export async function addNotMyTurnBlock(block: NotMyTurnBlock) {
  return getNotMyTurnBlockList().then((list) => {
    list.push(block);
    return storeNotMyTurnBlockList(list);
  });
}

export async function storeNotMyTurnBlockList(list: NotMyTurnBlock[]) {
  const chunks = splitArray(list, MAX_ITEM_BYTES_IN_SYNC_STORAGE);
  for (let i = 0; i < chunks.length; i++) {
    const store = getBucket<NotMyTurnBlockList>(
      NOT_MY_TURN_BLOCK_LIST_KEY_BASE + i,
      "sync",
    );
    await store.set(chunks[i]);
  }
  const store = getBucket<NotMyTurnBlockList>(
    NOT_MY_TURN_BLOCK_LIST_KEY_BASE + chunks.length,
    "sync",
  );
  await store.clear;
}

function splitArray(
  blocks: NotMyTurnBlock[],
  maxBytes: number,
): NotMyTurnBlockList[] {
  const resultBuilder = [] as NotMyTurnBlockList[];
  let itemBuilder = [] as NotMyTurnBlock[];
  for (const block of blocks) {
    if (getBytes(itemBuilder) + getBytes([block]) > maxBytes) {
      resultBuilder.push(new NotMyTurnBlockList(itemBuilder));
      itemBuilder = [];
    }
    itemBuilder.push(block);
  }
  resultBuilder.push(new NotMyTurnBlockList(itemBuilder));
  return resultBuilder;
}

function getBytes(notMyTurnBlockList: NotMyTurnBlock[]) {
  return new Blob([JSON.stringify(notMyTurnBlockList)]).size;
}

export async function getNotMyTurnBlockList(): Promise<NotMyTurnBlock[]> {
  const resultBuilder = [] as NotMyTurnBlock[];
  let chunkIndex = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const store = getBucket<NotMyTurnBlockList>(
      NOT_MY_TURN_BLOCK_LIST_KEY_BASE + chunkIndex,
      "sync",
    );
    const list = await store.get();
    if (list && list.notMyTurnBlockList) {
      resultBuilder.push(...list.notMyTurnBlockList);
    } else {
      break;
    }
    chunkIndex++;
  }
  return resultBuilder;
}
