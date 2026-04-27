import {
  ROLE_ASSIGN,
  ROLE_STANDARD
} from '#/server/common/helpers/auth/auth-scopes.js'

export const STUB_USERS = [
  {
    id: 'stub-standard-1',
    name: 'Stub Standard User',
    email: 'standard@stub.example',
    roles: [ROLE_STANDARD]
  },
  {
    id: 'stub-assign-1',
    name: 'Stub Assign User',
    email: 'assign@stub.example',
    roles: [ROLE_STANDARD, ROLE_ASSIGN]
  }
]

export function stubLoginGetController(_request, h) {
  return h.view('auth/stub/login', { users: STUB_USERS })
}

export function stubLoginPostController(request, h) {
  const { userId } = request.payload ?? {}
  const user = STUB_USERS.find((u) => u.id === userId)

  if (!user) {
    return h
      .view('auth/stub/login', {
        users: STUB_USERS,
        error: 'Please select a user'
      })
      .code(400)
  }

  request.yar.set('user', user)
  return h.redirect('/')
}
