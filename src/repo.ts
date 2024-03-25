export enum RepoType {
  GITHUB,
  GITLAB,
}

export interface RepoDto {
  readonly type: RepoType;
  readonly owner: string;
  readonly name: string;
  monitoringEnabled: boolean;
}

export class Repo implements RepoDto {
  constructor(
    public readonly type: RepoType,
    public readonly owner: string,
    public readonly name: string,
    /* User setting from the Options page: */
    public monitoringEnabled = true,
  ) {}

  // #NOT_MATURE: maybe this should be replaced with a dto interface:
  // https://stackoverflow.com/questions/34031448/typescript-typeerror-myclass-myfunction-is-not-a-function
  static fromDto(repo: RepoDto): Repo {
    return new Repo(
      repo.type ? repo.type : RepoType.GITHUB,
      repo.owner,
      repo.name,
      repo.monitoringEnabled,
    );
  }

  static fromFullName(
    fullName: string,
    repoType: RepoType,
    monitoringEnabled = true,
  ): Repo {
    const p = fullName.indexOf("/");
    if (p < 0) {
      window.alert(`Repo name should contain symbol '/'.`);
      throw new Error(`Repo name should contain symbol but found ${fullName}.`);
    }

    return new Repo(
      repoType,
      fullName.substring(0, p),
      fullName.substring(p + 1),
      monitoringEnabled,
    );
  }

  fullName(): string {
    return this.owner + "/" + this.name;
  }
}
