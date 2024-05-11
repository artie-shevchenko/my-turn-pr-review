import { ReviewRequest } from "./reviewRequest";
import { MyPR } from "./myPR";
import { Comment } from "./comment";

/** A successful or failed sync. */
export class RepoSyncResult {
  /* Undefined for a failed sync. */
  requestsForMyReview?: ReviewRequest[];

  /* Undefined for a failed sync. */
  myPRs?: MyPR[];

  /* Undefined for a failed sync. */
  comments?: Comment[];

  // see Settings#ignoreCommentsMoreThanXDaysOld
  ignoredCommentsMoreThanXDaysOld: number;

  syncStartUnixMillis: number;

  /* Undefined for a successful sync. */
  errorMsg?: string;

  /** Params may be undefined if used as a builder (hack). */
  constructor(
    requestsForMyReview?: ReviewRequest[],
    myPRs?: MyPR[],
    comments?: Comment[],
    ignoredCommentsMoreThanXDaysOld?: number,
    syncStartUnixMillis?: number,
    errorMsg?: string,
  ) {
    this.requestsForMyReview = requestsForMyReview;
    this.myPRs = myPRs;
    this.comments = comments;
    this.ignoredCommentsMoreThanXDaysOld = ignoredCommentsMoreThanXDaysOld;
    this.syncStartUnixMillis = syncStartUnixMillis;
    this.errorMsg = errorMsg;
  }

  /** Whether we treat is as still reliable data in absence of a more recent successful sync. */
  isRecent(lastSyncDurationMillis: number): boolean {
    const startIsWithinLast5Minutes =
      this.syncStartUnixMillis >= Date.now() - 1000 * 60 * 5;
    const isWithin5SyncsDuration =
      Date.now() - this.syncStartUnixMillis < 5 * lastSyncDurationMillis;
    return startIsWithinLast5Minutes || isWithin5SyncsDuration;
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
    const comments = repoSyncResult.comments?.map((v) => Comment.of(v)) || [];

    return new RepoSyncResult(
      requestsForMyReview,
      myPRs,
      comments,
      repoSyncResult.ignoredCommentsMoreThanXDaysOld
        ? repoSyncResult.ignoredCommentsMoreThanXDaysOld
        : 0,
      repoSyncResult.syncStartUnixMillis,
      repoSyncResult.errorMsg,
    );
  }
}
