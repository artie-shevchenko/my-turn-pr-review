import { ReviewRequest } from "./reviewRequest";
import { MyPR } from "./myPR";

export class RepoSyncResultDto {
  public requestsForMyReview?: ReviewRequest[];
  public myPRs?: MyPR[];
  public syncStartUnixMillis?: number;
  public errorMsg?: string;
}

/** A successful or failed sync. */
export class RepoSyncResult implements RepoSyncResultDto {
  constructor(
    /* Undefined for a failed sync. */
    public requestsForMyReview?: ReviewRequest[],
    /* Undefined for a failed sync. */
    public myPRs?: MyPR[],
    public syncStartUnixMillis?: number,
    /* Undefined for a successful sync. */
    public errorMsg?: string,
  ) {}

  /** Whether we treat is as still reliable data in absence of a more recent successful sync. */
  isRecent(): boolean {
    return this.syncStartUnixMillis >= Date.now() - 1000 * 60 * 5;
  }

  static fromDto(dto: RepoSyncResultDto): RepoSyncResult {
    let requestsForMyReview = [] as ReviewRequest[];
    // The field was renamed, so it will be undefined if user has not yet synced after the extension
    // update:
    if (dto.requestsForMyReview) {
      requestsForMyReview = dto.requestsForMyReview
        ? dto.requestsForMyReview.map((v) => ReviewRequest.of(v))
        : undefined;
    }

    const myPRs = dto.myPRs?.map((v) => MyPR.fromDto(v)) || [];

    return new RepoSyncResult(
      requestsForMyReview,
      myPRs,
      dto.syncStartUnixMillis,
      dto.errorMsg,
    );
  }
}
