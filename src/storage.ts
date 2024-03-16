import { getBucket } from "@extend-chrome/storage";

const REPO_STORE_KEY = "reposStore";
const REPO_STATE_LIST_STORE_KEY = "repoStateListStore";

export class Repo {
  readonly owner: string;
  readonly name: string;
  /* User setting from the Options page: */
  monitoringEnabled: boolean;

  // TODO(4): add support for when somebody submits you a new review, mention, etc.?

  constructor(owner: string, name: string, monitoringEnabled = true) {
    this.owner = owner;
    this.name = name;
    this.monitoringEnabled = monitoringEnabled;
  }

  // TODO This should be replaces with dto interface
  // NOTE:
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static of(repo: Repo): Repo {
    return new Repo(repo.owner, repo.name, repo.monitoringEnabled);
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

  hasRecentSuccessfulSync(): boolean {
    return (
      this.lastSuccessfulSyncResult && this.lastSuccessfulSyncResult.isRecent()
    );
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
  requestsForMyReview: ReviewRequest[];

  /* Undefined for a failed sync. */
  myPRs: MyPR[];

  syncStartUnixMillis: number;

  /* Undefined for a successful sync. */
  errorMsg: string;

  constructor(
    requestsForMyReview: ReviewRequest[] = undefined,
    myPRs: MyPR[] = undefined,
    syncStartUnixMillis: number = undefined,
    errorMsg: string = undefined,
  ) {
    this.requestsForMyReview = requestsForMyReview;
    this.myPRs = myPRs;
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
    let requestsForMyReview = [] as ReviewRequest[];
    // The field was renamed, so it will be undefined if user has not yet synced after the extension
    // update:
    if (repoSyncResult.requestsForMyReview) {
      requestsForMyReview = repoSyncResult.requestsForMyReview
        ? repoSyncResult.requestsForMyReview.map((v) => ReviewRequest.of(v))
        : undefined;
    }

    const myPRs = repoSyncResult.myPRs?.map((v) => MyPR.of(v)) || [];

    return new RepoSyncResult(
      requestsForMyReview,
      myPRs,
      repoSyncResult.syncStartUnixMillis,
      repoSyncResult.errorMsg,
    );
  }
}

// #NOT_MATURE: reused both for reviews and review requests.
export enum ReviewState {
  REQUESTED,
  COMMENTED,
  CHANGES_REQUESTED,
  APPROVED,
}

// APPROVED or APPROVED_AND_COMMENTED possible only if reviewsRequested is empty.
export enum MyPRReviewStatus {
  // NONE stands for "Ball is still on the other side" (ignore this PR):
  NONE,
  CHANGES_REQUESTED,
  APPROVED,
  APPROVED_AND_COMMENTED,
  COMMENTED,
}

export class ReviewerState {
  reviewerId: number;
  state: ReviewState;

  constructor(reviewerId: number, state: ReviewState) {
    this.reviewerId = reviewerId;
    this.state = state;
  }
}

export class MyPR {
  pr: PR;
  reviewerStates: ReviewerState[];

  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  static ofGitHubResponses(
    pr: PR,
    reviewsReceived: ReviewOnMyPR[],
    reviewsRequested: ReviewRequestOnMyPR[],
    myUserId: number,
  ): MyPR {
    reviewsReceived.sort(
      (a, b) => a.submittedAtUnixMillis - b.submittedAtUnixMillis,
    );
    const reviewerIds = new Set<number>();
    // Map them by reviewer ID:
    const reviewByReviewerId = new Map<number, ReviewOnMyPR[]>();
    for (const review of reviewsReceived) {
      let list = reviewByReviewerId.get(review.reviewerId);
      if (!list) {
        list = [];
        reviewByReviewerId.set(review.reviewerId, list);
      }
      list.push(review);
      reviewerIds.add(review.reviewerId);
    }
    const reviewRequestByReviewerId = new Map<number, ReviewRequestOnMyPR>();
    for (const reviewRequested of reviewsRequested) {
      reviewRequestByReviewerId.set(
        reviewRequested.reviewerId,
        reviewRequested,
      );
      reviewerIds.add(reviewRequested.reviewerId);
    }

    const reviewerStateBuilder = [] as ReviewerState[];
    for (const reviewerId of reviewerIds) {
      if (reviewerId === myUserId) {
        continue;
      }

      if (reviewRequestByReviewerId.get(reviewerId)) {
        reviewerStateBuilder.push(
          new ReviewerState(reviewerId, ReviewState.REQUESTED),
        );
        continue;
      }

      const sortedReviews = reviewByReviewerId.get(reviewerId);
      // Same as visualized in GitHub UI:
      const lastReviewState = sortedReviews
        .map((r) => r.state)
        .reduce((result, currentState) => {
          if (result == null) {
            // That's the only way it can become COMMENTED:
            return currentState;
          } else {
            if (
              currentState === ReviewState.APPROVED ||
              currentState === ReviewState.CHANGES_REQUESTED
            ) {
              return currentState;
            } else {
              // Preserve the current state:
              return result;
            }
          }
        }, null);
      reviewerStateBuilder.push(new ReviewerState(reviewerId, lastReviewState));
    }
    return new MyPR(pr, reviewerStateBuilder);
  }

  constructor(pr: PR, reviewerStates: ReviewerState[]) {
    this.pr = pr;
    this.reviewerStates = reviewerStates;
  }

  getStatus(): MyPRReviewStatus {
    const states = [] as ReviewState[];
    this.reviewerStates.forEach((reviewerState) => {
      states.push(reviewerState.state);
    });

    if (states.every((state) => state === ReviewState.CHANGES_REQUESTED)) {
      return MyPRReviewStatus.NONE;
    } else if (
      states.some((state) => state === ReviewState.CHANGES_REQUESTED)
    ) {
      return MyPRReviewStatus.CHANGES_REQUESTED;
    } else if (states.some((state) => state === ReviewState.COMMENTED)) {
      if (states.some((state) => state === ReviewState.APPROVED)) {
        if (states.some((state) => state === ReviewState.REQUESTED)) {
          return MyPRReviewStatus.COMMENTED;
        } else {
          return MyPRReviewStatus.APPROVED_AND_COMMENTED;
        }
      } else {
        return MyPRReviewStatus.COMMENTED;
      }
    } else {
      if (states.some((state) => state === ReviewState.REQUESTED)) {
        return MyPRReviewStatus.NONE;
      } else {
        return MyPRReviewStatus.APPROVED;
      }
    }
  }

  static of(v: MyPR): MyPR {
    return new MyPR(v.pr, v.reviewerStates ? v.reviewerStates : []);
  }
}

export class ReviewOnMyPR {
  pr: PR;
  reviewerId: number;
  state: ReviewState;
  submittedAtUnixMillis: number;

  constructor(
    pr: PR,
    reviewerId: number,
    state: ReviewState,
    submittedAtUnixMillis: number,
  ) {
    this.pr = pr;
    this.reviewerId = reviewerId;
    this.state = state;
    this.submittedAtUnixMillis = submittedAtUnixMillis;
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

  static of(v: ReviewRequest): ReviewRequest {
    return new ReviewRequest(v.pr, v.firstTimeObservedUnixMillis);
  }
}

export class ReviewRequestOnMyPR {
  pr: PR;
  reviewerId: number;

  constructor(pr: PR, reviewerId: number) {
    this.pr = pr;
    this.reviewerId = reviewerId;
  }

  static of(v: ReviewRequestOnMyPR): ReviewRequestOnMyPR {
    return new ReviewRequestOnMyPR(v.pr, v.reviewerId);
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

export async function storeReposMap(
  reposByFullName: Map<string, Repo>,
): Promise<RepoList> {
  console.log("Storing repos");
  const repos = [] as Repo[];
  reposByFullName.forEach((repo: Repo) => {
    repos.push(repo);
  });
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

export async function storeRepoStateMap(
  repoStateByFullName: Map<string, RepoState>,
): Promise<RepoStateList> {
  console.log("Storing repos state");
  const repoStateList = [] as RepoState[];
  repoStateByFullName.forEach((repoState: RepoState) => {
    repoStateList.push(repoState);
  });
  return getBucket<RepoStateList>(REPO_STATE_LIST_STORE_KEY, "local").set(
    new RepoStateList(repoStateList),
  );
}

export async function getRepoStateByFullName(): Promise<
  Map<string, RepoState>
> {
  return getRepoStateList().then((repoStateList) => {
    const result = new Map<string, RepoState>();
    repoStateList.forEach((repoState) =>
      result.set(repoState.fullName, repoState),
    );
    return result;
  });
}

async function getRepoStateList(): Promise<RepoState[]> {
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
