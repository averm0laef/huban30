/** A read of the API that did not give the storefront what it asked for; `status` is the API's answer (503 when none). */
export class StorefrontApiError extends Error {
  /** `movedTo`: the API's address of today of a product renamed in 1С, for a 404 of its former address. */
  constructor(message: string, readonly status: number, readonly movedTo: string | null = null) {
    super(message);
    this.name = "StorefrontApiError";
  }
}
