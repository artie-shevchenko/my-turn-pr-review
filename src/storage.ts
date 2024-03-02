import { getBucket } from "@extend-chrome/storage";

const REPO_STORE_KEY = "reposStore";
const REPO_STATE_LIST_STORE_KEY = "repoStateListStore";

export class Repo {
  readonly owner: string;
  readonly name: string;
  /* User setting from the Options page: */
  monitoringEnabled: boolean;

  // TODO(4): add support for when somebody submits you a new review, mention, etc.?

  constructor(
      owner: string,
      name: string,
      monitoringEnabled = true,
  ) {
    this.owner = owner;
    this.name = name;
    this.monitoringEnabled = monitoringEnabled;
  }

  // TODO This should be replaces with dto interface
  // NOTE:
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repo: Repo): Repo {
    return new Repo(
        repo.owner,
        repo.name,
        repo.monitoringEnabled,
    );
  }

  static fromFullName(fullName: string, monitoringEnabled = true): Repo {
    const p = fullName.indexOf("/");
    if (p < 0) {
      window.alert(`Repo name should contain symbol '/'.`);
      throw new Error(`Repo name should contain symbol but found ${fullName}.`);
    }

    return new Repo(
        fullName.substring(0, p),
        fullName.substring(p + 1),
        monitoringEnabled,
    );
  }

  fullName(): string {
    return this.owner + "/" + this.name;
  }
}

class RepoList {
  repos: Repo[];

  constructor(repos: Repo[]) {
    this.repos = repos;
  }
}

class RepoStateList {
  repoStateList: RepoState[];

  constructor(repos: RepoState[]) {
    this.repoStateList = repos;
  }
}


export class RepoState {
  readonly fullName: string;
  lastSyncResult: RepoSyncResult;
  // Undefined if there were no successful syncs.
  lastSuccessfulSyncResult: RepoSyncResult;

  constructor(
      repoFullName: string = undefined,
      lastSyncResult: RepoSyncResult = undefined,
      lastSuccessfulSyncResult: RepoSyncResult = undefined,
  ) {
    this.fullName = repoFullName;
    this.lastSyncResult = lastSyncResult;
    this.lastSuccessfulSyncResult = lastSuccessfulSyncResult;
  }

  // Probably better replaced with a dto interface. See
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repoState: RepoState): RepoState {
    return new RepoState(
        repoState.fullName,
        RepoSyncResult.of(repoState.lastSyncResult),
        repoState.lastSuccessfulSyncResult
            ? RepoSyncResult.of(repoState.lastSuccessfulSyncResult)
            : undefined,
    );
  }
}

/** A successful or failed sync. */
export class RepoSyncResult {
  /* Undefined for a failed sync. */
  reviewRequestList: ReviewRequest[];

  syncStartUnixMillis: number;

  /* Undefined for a successful sync. */
  errorMsg: string;

  constructor(
      reviewRequestList: ReviewRequest[] = undefined,
      syncStartUnixMillis: number = undefined,
      errorMsg: string = undefined,
  ) {
    this.reviewRequestList = reviewRequestList;
    this.syncStartUnixMillis = syncStartUnixMillis;
    this.errorMsg = errorMsg;
  }

  /** Whether we treat is as still reliable data in absence of a more recent successful sync. */
  isRecent(): boolean {
    return this.syncStartUnixMillis >= Date.now() - 1000 * 60 * 5;
  }

  // Probably better replaced with a dto interface. See
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repoSyncResult: RepoSyncResult): RepoSyncResult {
    const reviewRequestList = repoSyncResult.reviewRequestList
        ? repoSyncResult.reviewRequestList.map((v) => {
          return new ReviewRequest(v.pr, v.firstTimeObservedUnixMillis);
        })
        : undefined;
    return new RepoSyncResult(
        reviewRequestList,
        repoSyncResult.syncStartUnixMillis,
        repoSyncResult.errorMsg,
    );
  }
}

export class ReviewRequest {
  pr: PR;
  firstTimeObservedUnixMillis: number;
  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  constructor(pr: PR, firstTimeObservedUnixMillis: number) {
    this.pr = pr;
    this.firstTimeObservedUnixMillis = firstTimeObservedUnixMillis;
  }
}

export class PR {
  url: string;
  name: string;

  constructor(url: string, name: string) {
    this.url = url;
    this.name = name;
  }
}

export class GitHubUser {
  id: number;
  token: string;

  constructor(id: number, token: string) {
    this.id = id;
    this.token = token;
  }
}

// Repo storage:

export async function storeReposMap(reposByFullName: Map<string, Repo>): Promise<RepoList> {
  console.log("Storing repos");
  const repos = [] as Repo[];
  reposByFullName.forEach((repo: Repo) => {
    repos.push(repo);
  });
  return getBucket<RepoList>(REPO_STORE_KEY, "sync").set(new RepoList(repos));
}

export async function getRepos(): Promise<Repo[]> {
  return (
      getBucket<RepoList>(REPO_STORE_KEY, "sync")
          .get()
          // storage returns an Object, not a Repo...
          .then((l) => (l && l.repos) ? l.repos.map((v) => Repo.of(v)) : [])
  );
}

// RepoState storage:

export async function storeRepoStateMap(repoStateByFullName: Map<string, RepoState>): Promise<RepoStateList> {
  console.log("Storing repos state");
  const repoStateList = [] as RepoState[];
  repoStateByFullName.forEach((repoState: RepoState) => {
    repoStateList.push(repoState);
  });
  return getBucket<RepoStateList>(REPO_STATE_LIST_STORE_KEY, "sync")
      .set(new RepoStateList(repoStateList));
}

export async function getRepoStateByFullName(): Promise<Map<string, RepoState>> {
  return getRepoStateList().then((repoStateList) => {
    const result = new Map<string, RepoState>();
    repoStateList.forEach((repoState) => result.set(repoState.fullName, repoState));
    return result;
  });
}

async function getRepoStateList(): Promise<RepoState[]> {
  return (
      getBucket<RepoStateList>(REPO_STATE_LIST_STORE_KEY, "sync")
          .get()
          // storage returns an Object, not a Repo...
          .then((l) => {
            return (l && l.repoStateList) ?
                l.repoStateList.map((v) => RepoState.of(v)) : [];
          })
  );
}

// GitHubUser storage:

export async function storeGitHubUser(user: GitHubUser) {
  console.log("Storing GitHub user");
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
