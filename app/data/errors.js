// Data-layer error shared by every adapter and the repositories: carries a Postgres SQLSTATE in `code`.
export class DataError extends Error {
  constructor(code, message, details) { super(message); this.name = 'DataError'; this.code = code; this.details = details; }
}
