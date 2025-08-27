import { readonly } from 'vue'
import type { Ref } from 'vue'
import type { CommonUseAuthReturn, GetSessionOptions, SecondarySignInOptions, SignOutOptions, SignUpOptions } from '../../types'
import { jsonPointerGet, objectFromJsonPointer, useTypedBackendConfig } from '../../helpers'
import { _fetch } from '../../utils/fetch'
import { getRequestURLWN } from '../common/getRequestURL'
import { ERROR_PREFIX } from '../../utils/logger'
import { determineCallbackUrl } from '../../utils/callbackUrl'
import { formatToken } from './utils/token'
import { useAuthState } from './useAuthState'
// @ts-expect-error - #auth not defined
import type { SessionData } from '#auth'
import { navigateTo, nextTick, useNuxtApp, useRequestHeaders, useRoute, useRuntimeConfig } from '#imports'
import { callWithNuxt, useCookie } from '#app'
import type { NuxtApp } from '#app'
import { makeCWN } from '../../utils/callWithNuxt'
import { createError } from 'h3'
import type { GetCsrfTokenFunc } from '../authjs/useAuth'

interface Credentials extends Record<string, any> {
  username?: string
  email?: string
  password?: string
}

export interface RequestCookiesFunc<T = { cookie: string } | {}>{
  (
    nuxt: NuxtApp
  ): Promise<T | undefined>
}

export interface SignInFunc<T = Record<string, any>> {
  (
    credentials: Credentials,
    signInOptions?: SecondarySignInOptions,
    paramsOptions?: Record<string, string>,
    headersOptions?: Record<string, string>
  ): Promise<T | undefined>
}

export interface SignUpFunc<T = Record<string, any>> {
  (credentials: Credentials, signUpOptions?: SignUpOptions): Promise<T | undefined>
}

export interface SignOutFunc<T = unknown> {
  (options?: SignOutOptions): Promise<T | undefined>
}

/**
 * Returns an extended version of CommonUseAuthReturn with local-provider specific data
 *
 * @remarks
 * The returned value of `refreshToken` will always be `null` if `refresh.isEnabled` is `false`
 */
interface UseAuthReturn extends CommonUseAuthReturn<SignInFunc, SignOutFunc, SessionData> {
  getCsrfToken: GetCsrfTokenFunc
  // getRequestCookies: RequestCookiesFunc
  signUp: SignUpFunc
  // token: Readonly<Ref<string | null>>
  // refreshToken: Readonly<Ref<string | null>>
}

export function useAuth(): UseAuthReturn {
  const nuxt = useNuxtApp()
  const runtimeConfig = useRuntimeConfig()
  const config = useTypedBackendConfig(runtimeConfig, 'cookie')

  const {
    data,
    status,
    lastRefreshedAt,
    loading,
    // token,
    // refreshToken,
    // rawToken,
    // rawRefreshToken,
    // _internal
  } = useAuthState()

    /**
   * Utilities to make nested async composable calls play nicely with nuxt.
   *
   * Calling nested async composable can lead to "nuxt instance unavailable" errors. See more details here: https://github.com/nuxt/framework/issues/5740#issuecomment-1229197529. To resolve this we can manually ensure that the nuxt-context is set. This module contains `callWithNuxt` helpers for some of the methods that are frequently called in nested `useAuth` composable calls.
   *
   */
  async function getRequestCookies(nuxt: NuxtApp): Promise<{ cookie: string } | {}> {
    // `useRequestHeaders` is sync, so we narrow it to the awaited return type here
    type CookieHeader = { cookie?: string }
    const { cookie } = await callWithNuxt(nuxt, () => useRequestHeaders(['cookie']) as CookieHeader)

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

  async function signIn<T = Record<string, any>>(
    credentials: Credentials,
    signInOptions?: SecondarySignInOptions,
    signInParams?: Record<string, string>,
    signInHeaders?: Record<string, string>
  ): Promise<T | undefined> {
    const nuxt = useNuxtApp()

    const config = useTypedBackendConfig(useRuntimeConfig(), 'cookie')
    console.log(config.endpoints);
    const { path, method } = config.endpoints.signIn

    const csrfToken = useCookie(config.csrf?.cookie_name)
    if (!csrfToken.value) {
      await getCsrfTokenWithNuxt(nuxt)
      if (!csrfToken) {
        throw createError({ statusCode: 400, statusMessage: 'Could not fetch CSRF Token for signing in' })
      }
    }

    const response = await _fetch<T>(nuxt, path, {
      method,
      body: credentials,
      params: signInParams ?? {},
      headers: signInHeaders ?? {}
    })

    if (typeof response !== 'object' || response === null) {
      console.error(`${ERROR_PREFIX} signIn returned non-object value`)
      return
    }

    // Extract the access token
    // const extractedToken = jsonPointerGet(response, config.token.signInResponseTokenPointer)
    // if (typeof extractedToken !== 'string') {
    //   console.error(
    //     `${ERROR_PREFIX} string token expected, received instead: ${JSON.stringify(extractedToken)}. `
    //     + `Tried to find token at ${config.token.signInResponseTokenPointer} in ${JSON.stringify(response)}`
    //   )
    //   return
    // }
    // rawToken.value = extractedToken

    // Extract the refresh token if enabled
    // if (config.refresh.isEnabled) {
    //   const refreshTokenPointer = config.refresh.token.signInResponseRefreshTokenPointer

    //   const extractedRefreshToken = jsonPointerGet(response, refreshTokenPointer)
    //   if (typeof extractedRefreshToken !== 'string') {
    //     console.error(
    //       `${ERROR_PREFIX} string token expected, received instead: ${JSON.stringify(extractedRefreshToken)}. `
    //       + `Tried to find refresh token at ${refreshTokenPointer} in ${JSON.stringify(response)}`
    //     )
    //     return
    //   }
    //   rawRefreshToken.value = extractedRefreshToken
    // }

    const { redirect = true, external, callGetSession = true } = signInOptions ?? {}

    if (callGetSession) {
      await nextTick(getSession)
    }

    if (redirect) {
      let callbackUrl = signInOptions?.callbackUrl
      if (typeof callbackUrl === 'undefined') {
        const redirectQueryParam = useRoute()?.query?.redirect
        callbackUrl = await determineCallbackUrl(runtimeConfig.public.auth, redirectQueryParam?.toString())
      }

      await navigateTo(callbackUrl, { external })
      return
    }

    return response
  }

  async function signOut<T = unknown>(signOutOptions?: SignOutOptions): Promise<T | undefined> {
    const nuxt = useNuxtApp()
    const signOutConfig = config.endpoints.signOut

    let headers
    let body

    // if (signOutConfig) {
    //   headers = new Headers({ [config.token.headerName]: token.value } as HeadersInit)
    //   // If the refresh provider is used, include the refreshToken in the body
    //   if (config.refresh.isEnabled && ['post', 'put', 'patch', 'delete'].includes(signOutConfig.method.toLowerCase())) {
    //     // This uses refresh token pointer as we are passing `refreshToken`
    //     const signoutRequestRefreshTokenPointer = config.refresh.token.refreshRequestTokenPointer
    //     body = objectFromJsonPointer(signoutRequestRefreshTokenPointer, refreshToken.value)
    //   }
    // }

    data.value = null
    // rawToken.value = null
    // rawRefreshToken.value = null

    let res: T | undefined
    if (signOutConfig) {
      const { path, method } = signOutConfig
      res = await _fetch(nuxt, path, { method, headers, body })
    }

    const { redirect = true, external } = signOutOptions ?? {}

    const csrfToken = useCookie(config.csrf?.cookie_name)
    if (!csrfToken.value) {
      await getCsrfTokenWithNuxt(nuxt)
      if (!csrfToken) {
        throw createError({ statusCode: 400, statusMessage: 'Could not fetch CSRF Token for signing out' })
      }
    }

    if (redirect) {
      let callbackUrl = signOutOptions?.callbackUrl
      if (typeof callbackUrl === 'undefined') {
        const redirectQueryParam = useRoute()?.query?.redirect
        callbackUrl = await determineCallbackUrl(runtimeConfig.public.auth, redirectQueryParam?.toString(), true)
      }
      await navigateTo(callbackUrl, { external })
    }

    return res
  }

  async function getSession(getSessionOptions?: GetSessionOptions): Promise<SessionData | null | void> {
    const { path, method } = config.endpoints.getSession

    // let tokenValue = token.value
    // For cached responses, return the token directly from the cookie
    // tokenValue ??= formatToken(_internal.rawTokenCookie.value, config)

    // if (!tokenValue && !getSessionOptions?.force) {
    //   loading.value = false
    //   return
    // }

    const headers = new Headers(useRequestHeaders(['cookie']))
    // if (tokenValue) {
    //   headers.append(config.token.headerName, tokenValue)
    // }

    loading.value = true
    const url = await getRequestURLWN(nuxt)
    headers.append('Referer', url)

    try {
      const result = await _fetch<any>(nuxt, path, { method, headers })
      data.value = result
    }
    catch (err) {
      const { required = false } = getSessionOptions ?? {};

      if (!data.value && required) {
        console.log('Missing required session data.')
      }

      // Clear all data: Request failed so we must not be authenticated
      data.value = null
    }
    loading.value = false
    lastRefreshedAt.value = new Date()

    const { required = false, callbackUrl, onUnauthenticated, external } = getSessionOptions ?? {}
    if (required && data.value === null) {
      if (onUnauthenticated) {
        return onUnauthenticated()
      }
      await navigateTo(callbackUrl ?? await getRequestURLWN(nuxt), { external })
    }

    return data.value
  }

  async function signUp<T>(credentials: Credentials, signUpOptions?: SignUpOptions): Promise<T | undefined> {
    const signUpEndpoint = config.endpoints.signUp

    if (!signUpEndpoint) {
      console.warn(`${ERROR_PREFIX} provider.endpoints.signUp is disabled.`)
      return
    }

    const { path, method } = signUpEndpoint

    // Holds result from fetch to be returned if signUpOptions?.preventLoginFlow is true
    const result = await _fetch<T>(nuxt, path, {
      method,
      body: credentials
    })

    if (signUpOptions?.preventLoginFlow) {
      return result
    }

    return signIn<T>(credentials, signUpOptions)
  }

  // async function refresh(getSessionOptions?: GetSessionOptions) {
  //   // Only refresh the session if the refresh logic is not enabled
  //   if (!config.refresh.isEnabled) {
  //     return getSession(getSessionOptions)
  //   }

  //   const { path, method } = config.refresh.endpoint
  //   const refreshRequestTokenPointer = config.refresh.token.refreshRequestTokenPointer

  //   const headers = new Headers({
  //     [config.token.headerName]: token.value
  //   } as HeadersInit)

  //   const response = await _fetch<Record<string, any>>(nuxt, path, {
  //     method,
  //     headers,
  //     body: objectFromJsonPointer(refreshRequestTokenPointer, refreshToken.value)
  //   })

  //   // Extract the new token from the refresh response
  //   const tokenPointer = config.refresh.token.refreshResponseTokenPointer || config.token.signInResponseTokenPointer
  //   const extractedToken = jsonPointerGet(response, tokenPointer)
  //   if (typeof extractedToken !== 'string') {
  //     console.error(
  //       `Auth: string token expected, received instead: ${JSON.stringify(extractedToken)}. `
  //       + `Tried to find token at ${tokenPointer} in ${JSON.stringify(response)}`
  //     )
  //     return
  //   }

  //   if (!config.refresh.refreshOnlyToken) {
  //     const refreshTokenPointer = config.refresh.token.signInResponseRefreshTokenPointer
  //     const extractedRefreshToken = jsonPointerGet(response, refreshTokenPointer)
  //     if (typeof extractedRefreshToken !== 'string') {
  //       console.error(
  //         `Auth: string token expected, received instead: ${JSON.stringify(extractedRefreshToken)}. `
  //         + `Tried to find refresh token at ${refreshTokenPointer} in ${JSON.stringify(response)}`
  //       )
  //       return
  //     }

  //     rawRefreshToken.value = extractedRefreshToken
  //   }

  //   rawToken.value = extractedToken
  //   lastRefreshedAt.value = new Date()

  //   await nextTick()
  //   return getSession(getSessionOptions)
  // }

  return {
    status,
    data: readonly(data),
    lastRefreshedAt: readonly(lastRefreshedAt),
    // token: readonly(token),
    // refreshToken: readonly(refreshToken),
    getCsrfToken,
    // getRequestCookies,
    getSession,
    signIn,
    signOut,
    signUp,
    // refresh
  }
}
