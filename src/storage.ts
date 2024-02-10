import { getBucket } from "@extend-chrome/storage";

export class Repo {
  readonly owner: string;
  readonly name: string;
  /* User setting from the Options page: */
  monitoringEnabled: boolean;
  /* monitoringEnabled value during the last sync: */
  lastSyncAttempted: boolean;
  // TODO(3): replace with a last successful sync timestamp? Then it would make sense to show a
  // yellow icon if there was no successful sync in the last 5 minutes, for example.
  /* Whether the last attempt to sync (last time when monitoringEnabled was true) succeeded or not: */
  lastAttemptSuccess: boolean;
  /* The last sync attempt error regardless when it was and whether the last attempt was successful or not: */
  lastSyncError: string;
  reviewsRequested: ReviewRequested[];

  // TODO(4): add support for when somebody submits you a new review, mention, etc.?

  constructor(
    owner: string,
    name: string,
    monitoringEnabled = true,
    lastSyncAttempted: boolean = undefined,
    lastAttemptSuccess: boolean = undefined,
    lastSyncError: string = undefined,
    reviewsRequested: ReviewRequested[] = [],
  ) {
    this.owner = owner;
    this.name = name;
    this.monitoringEnabled = monitoringEnabled;
    this.lastSyncAttempted = lastSyncAttempted;
    this.lastAttemptSuccess = lastAttemptSuccess;
    this.lastSyncError = lastSyncError;
    this.reviewsRequested = reviewsRequested;
  }

  // TODO This should be replaces with dto interface
  // NOTE: https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repo: Repo): Repo {
    return new Repo(
      repo.owner,
      repo.name,
      repo.monitoringEnabled,
      repo.lastSyncAttempted,
      repo.lastAttemptSuccess,
      repo.lastSyncError,
      repo.reviewsRequested,
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

export class ReviewRequested {
  pr: PR;
  firstTimeObservedUnixMillis: number;
  repo: string;

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

export async function storeReposMap(reposByFullName: Map<string, Repo>) {
  const reposStore = getBucket<RepoList>("reposStore", "sync");
  const repos = [] as Repo[];
  reposByFullName.forEach((repo: Repo) => {
    repos.push(repo);
  });
  return reposStore.set(new RepoList(repos));
}

export async function storeRepos(repos: Repo[]) {
  const reposStore = getBucket<RepoList>("reposStore", "sync");
  return reposStore.set(new RepoList(repos));
}

export async function getReposByFullName(): Promise<Map<string, Repo>> {
  return getRepos().then((repos) => {
    const result = new Map<string, Repo>();
    repos.forEach((repo) => result.set(repo.fullName(), repo));
    return result;
  });
}

export async function getRepos(): Promise<Repo[]> {
  return (
    getBucket<RepoList>("reposStore", "sync")
      .get()
      // storage returns an Object, not a Repo...
      .then((l) => l.repos.map((v) => Repo.of(v)))
  );
}

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
