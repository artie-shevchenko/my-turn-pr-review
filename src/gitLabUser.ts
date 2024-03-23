export class GitLabUser {
  id: number;
  token: string;

  constructor(id: number, token: string) {
    this.id = id;
    this.token = token;
  }
}
