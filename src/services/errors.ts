import "server-only";

/** A problem with the request (bad input, wrong state). Safe to show to the caller. */
export class ServiceError extends Error {}
