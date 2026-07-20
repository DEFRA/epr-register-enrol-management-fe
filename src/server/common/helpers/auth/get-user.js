// Returns the authenticated user from the request, or null
export function getUser(request) {
  return request.auth?.credentials ?? null
}
