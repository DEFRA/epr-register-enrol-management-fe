export const statusCodes = {
  ok: 200,
  noContent: 204,
  // RA-295: the retired two-step application-details page is a permanent
  // redirect so bookmarks and external links resolve rather than 404ing.
  movedPermanently: 301,
  redirect: 302,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  imATeapot: 418,
  internalServerError: 500,
  badGateway: 502
}
