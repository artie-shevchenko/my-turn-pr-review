import { getBucket } from "@extend-chrome/storage";

const REPO_STORE_KEY = "reposStore";
const REPO_STATE_LIST_STORE_KEY = "repoStateListStore";

export class Repo {
  readonly owner: string;
  readonly name: string;
  /* User setting from the Options page: */
  monitoringEnabled: boolean;

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
  submittedAtUnixMillis: number;

  constructor(
    reviewerId: number,
    state: ReviewState,
    // For ReviewState#REQUESTED leave it empty:
    submittedAtUnixMillis = 0,
  ) {
    this.reviewerId = reviewerId;
    this.state = state;
    this.submittedAtUnixMillis = submittedAtUnixMillis;
  }
}

export class MyPR {
  pr: PR;
  reviewerStates: ReviewerState[];
  notMyTurnBlockPresent: boolean;

  // #NOT_MATURE: lazily populated in popup.ts:
  repoFullName: string;

  static ofGitHubResponses(
    pr: PR,
    reviewsReceived: ReviewOnMyPR[],
    reviewsRequested: ReviewRequestOnMyPR[],
    myUserId: number,
    notMyTurnBlockList: NotMyTurnBlock[],
  ): MyPR {
    // will be overriden later:
    let lastReviewSubmittedUnixMillis = 0;
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
      lastReviewSubmittedUnixMillis = Math.max(
        lastReviewSubmittedUnixMillis,
        review.submittedAtUnixMillis,
      );
    }
    const notMyTurnBlockPresent = notMyTurnBlockList
      .filter((block) => block.prUrl === pr.url)
      .some(
        (block) =>
          block.lastReviewSubmittedUnixMillis >= lastReviewSubmittedUnixMillis,
      );

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
      reviewerStateBuilder.push(
        new ReviewerState(
          reviewerId,
          lastReviewState,
          sortedReviews[sortedReviews.length - 1].submittedAtUnixMillis,
        ),
      );
    }
    return new MyPR(pr, reviewerStateBuilder, notMyTurnBlockPresent);
  }

  constructor(
    pr: PR,
    reviewerStates: ReviewerState[],
    notMyTurnBlockPresent: boolean,
  ) {
    this.pr = pr;
    this.reviewerStates = reviewerStates;
    this.notMyTurnBlockPresent = notMyTurnBlockPresent;
  }

  getLastReviewSubmittedUnixMillis(): number {
    return Math.max(...this.reviewerStates.map((v) => v.submittedAtUnixMillis));
  }

  isBlockedBy(block: NotMyTurnBlock) {
    let lastReviewSubmittedUnixMillis = 0;
    for (const reviewerState of this.reviewerStates) {
      lastReviewSubmittedUnixMillis = Math.max(
        lastReviewSubmittedUnixMillis,
        reviewerState.submittedAtUnixMillis,
      );
    }
    return (
      this.pr.url === block.prUrl &&
      block.lastReviewSubmittedUnixMillis >= lastReviewSubmittedUnixMillis
    );
  }

  getStatus(): MyPRReviewStatus {
    if (this.notMyTurnBlockPresent) {
      return MyPRReviewStatus.NONE;
    }

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
    return new MyPR(
      v.pr,
      v.reviewerStates ? v.reviewerStates : [],
      v.notMyTurnBlockPresent ? v.notMyTurnBlockPresent : false,
    );
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
  // normally that's exactly when the review was requested but as a fallback it may use the time
  // when Chrome extension first observed this request:
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
  return storeRepoStateList(repoStateList);
}

export async function storeRepoStateList(repoStateList: RepoState[]) {
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

// NotMyTurnBlock storage:

export class NotMyTurnBlock {
  prUrl: string;
  lastReviewSubmittedUnixMillis: number;

  constructor(prUrl: string, lastReviewSubmittedUnixMillis: number) {
    this.prUrl = prUrl;
    this.lastReviewSubmittedUnixMillis = lastReviewSubmittedUnixMillis;
  }
}

class NotMyTurnBlockList {
  notMyTurnBlockList: NotMyTurnBlock[];

  constructor(notMyTurnBlockList: NotMyTurnBlock[]) {
    this.notMyTurnBlockList = notMyTurnBlockList;
  }
}

const NOT_MY_TURN_BLOCK_LIST_KEY_BASE = "notMyTurnBlockList";
const MAX_ITEM_BYTES_IN_SYNC_STORAGE = 8000 / 2; // to be on a safe side

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
