// Returns the authenticated user from the request, or null
export function getUser(request) {
  return request.auth?.credentials ?? null
}

// Returns true if the authenticated user has the given role
export function hasRole(request, role) {
  const roles = request.auth?.credentials?.roles ?? []
  return roles.includes(role)
}
