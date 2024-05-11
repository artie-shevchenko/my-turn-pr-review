import { getBucket } from "@extend-chrome/storage";
import { ReposState } from "./reposState";
import { Settings } from "./settings";
import { GitHubUser } from "./gitHubUser";
import { CommentBlock, MyPrBlock, ReviewRequestBlock } from "./block";
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

class RepoStateList {
  repoStateList: RepoState[];

  constructor(repos: RepoState[]) {
    this.repoStateList = repos;
  }
}

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

export async function getReposState(): Promise<ReposState> {
  return getRepoStateByFullName().then((repoStateMap) => {
    return new ReposState(repoStateMap);
  });
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

// GitHubUser storage:

class LastSyncStats {
  lastSyncDurationMillis: number;

  constructor(lastSyncDurationMillis: number) {
    this.lastSyncDurationMillis = lastSyncDurationMillis;
  }
}

export async function storeLastSyncDurationMillis(
  lastSyncDurationMillis: number,
) {
  const store = getBucket<LastSyncStats>("lastSyncDurationMillis", "local");
  return store.set(new LastSyncStats(lastSyncDurationMillis));
}

export async function getLastSyncDurationMillis(): Promise<number> {
  const store = getBucket<LastSyncStats>("lastSyncDurationMillis", "local");
  return store.get().then((v) => v.lastSyncDurationMillis);
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

const NO_PENDING_REVIEWS_TO_BE_MERGE_READY_DEFAULT = false;
const COMMENT_EQUALS_CHANGES_REQUESTED_DEFAULT = true;
// Even though GitHub thinks that's the case, default to false, see
// https://github.com/artie-shevchenko/my-turn-pr-review/issues/52
const SINGLE_COMMENT_IS_REVIEW_DEFAULT = false;
const IGNORE_COMMENTS_MORE_THAN_X_DAYS_OLD_DEFAULT = 5;

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
              /* noPendingReviewsToBeMergeReady = */
              NO_PENDING_REVIEWS_TO_BE_MERGE_READY_DEFAULT,
              /* commentEqualsChangesRequested = */
              COMMENT_EQUALS_CHANGES_REQUESTED_DEFAULT,
              /* singleCommentIsReview = */
              SINGLE_COMMENT_IS_REVIEW_DEFAULT,
              /* ignoreCommentsMoreThanXDaysOld = */
              IGNORE_COMMENTS_MORE_THAN_X_DAYS_OLD_DEFAULT,
            )
          : new Settings(
              stored.noPendingReviewsToBeMergeReady !== undefined
                ? stored.noPendingReviewsToBeMergeReady
                : NO_PENDING_REVIEWS_TO_BE_MERGE_READY_DEFAULT,
              stored.commentEqualsChangesRequested !== undefined
                ? stored.commentEqualsChangesRequested
                : COMMENT_EQUALS_CHANGES_REQUESTED_DEFAULT,
              stored.singleCommentIsReview !== undefined
                ? stored.singleCommentIsReview
                : SINGLE_COMMENT_IS_REVIEW_DEFAULT,
              stored.ignoreCommentsMoreThanXDaysOld !== undefined
                ? stored.ignoreCommentsMoreThanXDaysOld
                : IGNORE_COMMENTS_MORE_THAN_X_DAYS_OLD_DEFAULT,
            );
      })
  );
}

const MAX_ITEM_BYTES_IN_SYNC_STORAGE = 8000 / 2; // to be on a safe side

// MyPrBlock storage:

class MyPrBlockList {
  // legacy name, for backward-compatibility
  notMyTurnBlockList: MyPrBlock[];

  constructor(myPrBlockList: MyPrBlock[]) {
    this.notMyTurnBlockList = myPrBlockList;
  }
}

const MY_PR_BLOCK_LIST_KEY_BASE = "notMyTurnBlockList";

export async function addMyPrBlock(block: MyPrBlock) {
  return getMyPrBlockList().then((list) => {
    list.push(block);
    return storeMyPrBlockList(list);
  });
}

export async function storeMyPrBlockList(list: MyPrBlock[]) {
  const chunks = splitArray(list, MAX_ITEM_BYTES_IN_SYNC_STORAGE);
  for (let i = 0; i < chunks.length; i++) {
    const store = getBucket<MyPrBlockList>(
      MY_PR_BLOCK_LIST_KEY_BASE + i,
      "sync",
    );
    await store.set(chunks[i]);
  }
  const store = getBucket<MyPrBlockList>(
    MY_PR_BLOCK_LIST_KEY_BASE + chunks.length,
    "sync",
  );
  await store.clear;
}

function splitArray(blocks: MyPrBlock[], maxBytes: number): MyPrBlockList[] {
  const resultBuilder = [] as MyPrBlockList[];
  let itemBuilder = [] as MyPrBlock[];
  for (const block of blocks) {
    if (getBytes(itemBuilder) + getBytes([block]) > maxBytes) {
      resultBuilder.push(new MyPrBlockList(itemBuilder));
      itemBuilder = [];
    }
    itemBuilder.push(block);
  }
  resultBuilder.push(new MyPrBlockList(itemBuilder));
  return resultBuilder;
}

function getBytes(myPrBlockList: MyPrBlock[]) {
  return new Blob([JSON.stringify(myPrBlockList)]).size;
}

export async function getMyPrBlockList(): Promise<MyPrBlock[]> {
  const resultBuilder = [] as MyPrBlock[];
  let chunkIndex = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const store = getBucket<MyPrBlockList>(
      MY_PR_BLOCK_LIST_KEY_BASE + chunkIndex,
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

// ReviewRequestBlock storage:

class ReviewRequestBlockList {
  // legacy name, for backward-compatibility
  notMyTurnReviewRequestBlockList: ReviewRequestBlock[];

  constructor(reviewRequestBlockList: ReviewRequestBlock[]) {
    this.notMyTurnReviewRequestBlockList = reviewRequestBlockList;
  }
}

const REVIEW_REQUEST_BLOCK_LIST_KEY_BASE = "notMyTurnReviewRequestBlockList";

export async function addReviewRequestBlock(block: ReviewRequestBlock) {
  return getReviewRequestBlockList().then((list) => {
    list.push(block);
    return storeReviewRequestBlockList(list);
  });
}

export async function storeReviewRequestBlockList(list: ReviewRequestBlock[]) {
  const chunks = splitReviewRequestBlockArray(
    list,
    MAX_ITEM_BYTES_IN_SYNC_STORAGE,
  );
  for (let i = 0; i < chunks.length; i++) {
    const store = getBucket<ReviewRequestBlockList>(
      REVIEW_REQUEST_BLOCK_LIST_KEY_BASE + i,
      "sync",
    );
    await store.set(chunks[i]);
  }
  const store = getBucket<ReviewRequestBlockList>(
    REVIEW_REQUEST_BLOCK_LIST_KEY_BASE + chunks.length,
    "sync",
  );
  await store.clear;
}

function splitReviewRequestBlockArray(
  blocks: ReviewRequestBlock[],
  maxBytes: number,
): ReviewRequestBlockList[] {
  const resultBuilder = [] as ReviewRequestBlockList[];
  let itemBuilder = [] as ReviewRequestBlock[];
  for (const block of blocks) {
    if (
      getReviewRequestBlockBytes(itemBuilder) +
        getReviewRequestBlockBytes([block]) >
      maxBytes
    ) {
      resultBuilder.push(new ReviewRequestBlockList(itemBuilder));
      itemBuilder = [];
    }
    itemBuilder.push(block);
  }
  resultBuilder.push(new ReviewRequestBlockList(itemBuilder));
  return resultBuilder;
}

function getReviewRequestBlockBytes(
  reviewRequestBlockList: ReviewRequestBlock[],
) {
  return new Blob([JSON.stringify(reviewRequestBlockList)]).size;
}

export async function getReviewRequestBlockList(): Promise<
  ReviewRequestBlock[]
> {
  const resultBuilder = [] as ReviewRequestBlock[];
  let chunkIndex = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const store = getBucket<ReviewRequestBlockList>(
      REVIEW_REQUEST_BLOCK_LIST_KEY_BASE + chunkIndex,
      "sync",
    );
    const list = await store.get();
    if (list && list.notMyTurnReviewRequestBlockList) {
      resultBuilder.push(...list.notMyTurnReviewRequestBlockList);
    } else {
      break;
    }
    chunkIndex++;
  }
  return resultBuilder;
}

// CommentBlock storage:

class CommentBlockList {
  commentBlockList: CommentBlock[];

  constructor(commentBlockList: CommentBlock[]) {
    this.commentBlockList = commentBlockList;
  }
}

const COMMENT_BLOCK_LIST_KEY_BASE = "commentBlockList";

export async function addCommentBlock(block: CommentBlock) {
  return getCommentBlockList().then((list) => {
    list.push(block);
    return storeCommentBlockList(list);
  });
}

export async function storeCommentBlockList(list: CommentBlock[]) {
  const chunks = splitCommentBlockArray(list, MAX_ITEM_BYTES_IN_SYNC_STORAGE);
  for (let i = 0; i < chunks.length; i++) {
    const store = getBucket<CommentBlockList>(
      COMMENT_BLOCK_LIST_KEY_BASE + i,
      "sync",
    );
    await store.set(chunks[i]);
  }
  const store = getBucket<CommentBlockList>(
    COMMENT_BLOCK_LIST_KEY_BASE + chunks.length,
    "sync",
  );
  await store.clear;
}

function splitCommentBlockArray(
  blocks: CommentBlock[],
  maxBytes: number,
): CommentBlockList[] {
  const resultBuilder = [] as CommentBlockList[];
  let itemBuilder = [] as CommentBlock[];
  for (const block of blocks) {
    if (
      getCommentBlockBytes(itemBuilder) + getCommentBlockBytes([block]) >
      maxBytes
    ) {
      resultBuilder.push(new CommentBlockList(itemBuilder));
      itemBuilder = [];
    }
    itemBuilder.push(block);
  }
  resultBuilder.push(new CommentBlockList(itemBuilder));
  return resultBuilder;
}

function getCommentBlockBytes(commentBlockList: CommentBlock[]) {
  return new Blob([JSON.stringify(commentBlockList)]).size;
}

export async function getCommentBlockList(): Promise<CommentBlock[]> {
  const resultBuilder = [] as CommentBlock[];
  let chunkIndex = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const store = getBucket<CommentBlockList>(
      COMMENT_BLOCK_LIST_KEY_BASE + chunkIndex,
      "sync",
    );
    const list = await store.get();
    if (list && list.commentBlockList) {
      resultBuilder.push(...list.commentBlockList);
    } else {
      break;
    }
    chunkIndex++;
  }
  return resultBuilder;
}
