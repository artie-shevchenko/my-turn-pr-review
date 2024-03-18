import { ReviewRequest } from "./reviewRequest";
import { MyPR } from "./myPR";

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
