export class GitHubUser {
  id: number;
  login: string;
  token: string;

  constructor(id: number, login: string, token: string) {
    this.id = id;
    this.login = login;
    this.token = token;
  }
}
