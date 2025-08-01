import { readonly } from 'vue'
import { callWithNuxt, NuxtApp, useCookie, useRequestHeaders } from '#app'
import { CommonUseAuthReturn, SignOutFunc, SignInFunc, GetSessionFunc, SecondarySignInOptions } from '../../types'
import { _fetch } from '../../utils/fetch'
import { useTypedBackendConfig } from '../../helpers'
import { getRequestURLWN, makeCWN } from '../../utils/callWithNuxt'
import { useAuthState } from './useAuthState'
// @ts-expect-error - #auth not defined
import type { SessionData } from '#auth'
import { createError, useNuxtApp, useRuntimeConfig, nextTick, navigateTo } from '#imports'

type Credentials = { username?: string, email?: string, password?: string } & Record<string, any>

const isExternalUrl = (url: string) => {
  return !!(url && url.startsWith('http'))
}

/**
 * Utilities to make nested async composable calls play nicely with nuxt.
 *
 * Calling nested async composable can lead to "nuxt instance unavailable" errors. See more details here: https://github.com/nuxt/framework/issues/5740#issuecomment-1229197529. To resolve this we can manually ensure that the nuxt-context is set. This module contains `callWithNuxt` helpers for some of the methods that are frequently called in nested `useAuth` composable calls.
 *
 */
const getRequestCookies = async (nuxt: NuxtApp): Promise<{ cookie: string } | {}> => {
  // `useRequestHeaders` is sync, so we narrow it to the awaited return type here
  const { cookie } = await callWithNuxt(nuxt, () => useRequestHeaders(['cookie']) as HeadersInit)
  if (cookie) {
    return { cookie }
  }
  return {}
}
/**
 * Get the current Cross-Site Request Forgery token.
 *
 * You can use this to pass along for certain requests, most of the time you will not need it.
 */
const getCsrfToken = async () => {
  const nuxt = useNuxtApp()
  const headers = await getRequestCookies(nuxt)
  const config = useTypedBackendConfig(useRuntimeConfig(), 'cookie')
  const { path, method } = config.endpoints.csrf
  return _fetch<{ csrfToken: string }>(nuxt, path, { headers, method }).then(response => response.csrfToken)
}
const getCsrfTokenWithNuxt = makeCWN(getCsrfToken)

const signIn: SignInFunc<Credentials, any> = async (credentials, signInOptions, signInParams) => {
  const nuxt = useNuxtApp()

  const config = useTypedBackendConfig(useRuntimeConfig(), 'cookie')
  const { path, method } = config.endpoints.signIn

  const csrfToken = useCookie(config.csrf?.cookie_name)
  if (!csrfToken.value) {
    await getCsrfTokenWithNuxt(nuxt)
    if (!csrfToken) {
      throw createError({ statusCode: 400, statusMessage: 'Could not fetch CSRF Token for signing in' })
    }
  }

  await _fetch<Record<string, any>>(nuxt, path, {
    method,
    body: {
      ...credentials,
      ...(signInOptions ?? {})
    },
    params: signInParams ?? {}
  })

  await nextTick(getSession)

  const { callbackUrl, redirect = true } = signInOptions ?? {}
  if (redirect) {
    const urlToNavigateTo = callbackUrl ?? await getRequestURLWN(nuxt)
    return navigateTo(urlToNavigateTo, { external: isExternalUrl(urlToNavigateTo) })
  }
}

const signOut: SignOutFunc = async (signOutOptions) => {
  const nuxt = useNuxtApp()
  const runtimeConfig = await callWithNuxt(nuxt, useRuntimeConfig)
  const config = useTypedBackendConfig(runtimeConfig, 'cookie')
  const { data } = await callWithNuxt(nuxt, useAuthState)

  data.value = null

  const { path, method } = config.endpoints.signOut

  const res = await _fetch(nuxt, path, { method })

  const { callbackUrl, redirect = true } = signOutOptions ?? {}

  const csrfToken = useCookie(config.csrf?.cookie_name)
  if (!csrfToken.value) {
    await getCsrfTokenWithNuxt(nuxt)
    if (!csrfToken) {
      throw createError({ statusCode: 400, statusMessage: 'Could not fetch CSRF Token for signing out' })
    }
  }

  if (redirect) {
    const urlToNavigateTo = callbackUrl ?? await getRequestURLWN(nuxt)
    await navigateTo(urlToNavigateTo, { external: isExternalUrl(urlToNavigateTo) })
  }

  return res
}

const getSession: GetSessionFunc<SessionData | null | void> = async (getSessionOptions) => {
  const nuxt = useNuxtApp()

  const config = useTypedBackendConfig(useRuntimeConfig(), 'cookie')
  const { path, method } = config.endpoints.getSession
  const { data, loading, lastRefreshedAt } = useAuthState()

  const cookie = useCookie(config.cookie.name)

  loading.value = true
  const url = await getRequestURLWN(nuxt)

  try {
    let headers = { }
    if (cookie.value) {
      headers = { credentials: 'include', Cookie: `${config.cookie.name}=${cookie.value}`, Referer: url }
    }
    data.value = await _fetch<SessionData>(nuxt, path, { method, headers })
  } catch (e) {
    // Clear all data: Request failed so we must not be authenticated
    data.value = null
  }
  loading.value = false
  lastRefreshedAt.value = new Date()

  const { required = false, callbackUrl, onUnauthenticated } = getSessionOptions ?? {}
  if (required && data.value === null) {
    console.log('Missing required session data.')
    if (onUnauthenticated) {
      return onUnauthenticated()
    } else {
      const urlToNavigateTo = callbackUrl ?? await getRequestURLWN(nuxt)
      await navigateTo(urlToNavigateTo, { external: isExternalUrl(urlToNavigateTo) })
    }
  }

  return data.value
}

const signUp = async (credentials: Credentials, signInOptions?: SecondarySignInOptions) => {
  const nuxt = useNuxtApp()

  const { path, method } = useTypedBackendConfig(useRuntimeConfig(), 'cookie').endpoints.signUp
  await _fetch(nuxt, path, {
    method,
    body: credentials
  })

  return signIn(credentials, signInOptions)
}

interface UseAuthReturn extends CommonUseAuthReturn<typeof signIn, typeof signOut, typeof getSession, SessionData> {
  signUp: typeof signUp
  getCsrfToken: typeof getCsrfToken
}
export const useAuth = (): UseAuthReturn => {
  const {
    data,
    status,
    lastRefreshedAt
  } = useAuthState()

  const getters = {
    status,
    data: readonly(data),
    lastRefreshedAt: readonly(lastRefreshedAt)
  }

  const actions = {
    getSession,
    getCsrfToken,
    signIn,
    signOut,
    signUp
  }

  return {
    ...getters,
    ...actions
  }
}