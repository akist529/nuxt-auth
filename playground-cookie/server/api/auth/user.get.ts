import { createError, eventHandler, getCookie } from 'h3'
import { verify } from 'jsonwebtoken'
import { SECRET } from '~/server/api/auth/login.post'

export default eventHandler((event) => {
  const cookieValue = getCookie(event, 'ApplicationAuth')

  if (typeof cookieValue === 'undefined') {
    throw createError({ statusCode: 403, statusMessage: 'no cookie found' })
  }

  try {
    return verify(cookieValue, SECRET) // This is just a sample page. The cookie provider does not actually use JWTs.
  }
  catch (error) {
    console.error({ msg: 'Login failed. Here\'s the raw error:', error })
    throw createError({ statusCode: 403, message: 'You must be logged in to use this endpoint' })
  }
})
