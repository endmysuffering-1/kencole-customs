/** A refusal the caller can show to a person: a broken rule, not a crash. */
export class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "DomainError";
  }
}
