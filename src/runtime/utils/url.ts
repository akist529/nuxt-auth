import { joinURL, parseURL, withLeadingSlash } from 'ufo'
import getURL from 'requrl';
import { sendRedirect } from 'h3';
import { useRequestEvent, useNuxtApp } from '#app'
import { useAuthState } from '#imports';

// Slimmed down type to allow easy unit testing
export interface RuntimeConfig {
  public: {
    auth: {
      baseURL: string
      disableInternalRouting: boolean
      originEnvKey: string
    }
  }
}

export const getRequestURL = (includePath = true) => getURL(useRequestEvent()?.node.req, includePath)
export const joinPathToApiURL = (path: string) => joinURL(useAuthState()._internal.baseURL, path)

/**
 * Function to correctly navigate to auth-routes, necessary as the auth-routes are not part of the nuxt-app itself, so unknown to nuxt / vue-router.
 *
 * More specifically, we need this function to correctly handle the following cases:
 * 1. On the client-side, returning `navigateTo(signInUrl)` leads to a `404` error as the next-auth-signin-page was not registered with the vue-router that is used for routing under the hood. For this reason we need to
 *    manually set `window.location.href` on the client **and then fake return a Promise that does not immediately resolve to block navigation (although it will not actually be fully awaited, but just be awaited long enough for the naviation to complete)**.
 * 2. Additionally on the server-side, we cannot use `navigateTo(signInUrl)` as this uses `vue-router` internally which does not know the "external" sign-in page of next-auth and thus will log a warning which we want to avoid.
 *
 * Adapted from: https://github.com/nuxt/framework/blob/ab2456c295fc8c7609a7ef7ca1e47def5d087e87/packages/nuxt/src/app/composables/router.ts#L97-L115
 *
 * @param href HREF / URL to navigate to
 */
export const navigateToAuthPages = (href: string) => {
  const nuxtApp = useNuxtApp()

  if (process.server) {
    if (nuxtApp.ssrContext && nuxtApp.ssrContext.event) {
      return nuxtApp.callHook('app:redirected').then(() => sendRedirect(nuxtApp.ssrContext!.event, href, 302))
    }
  }

  window.location.href = href
  // If href contains a hash, the browser does not reload the page. We reload manually.
  if (href.includes('#')) {
    window.location.reload()
  }

  // TODO: Sadly, we cannot directly import types from `vue-router` as it leads to build failures. Typing the router about should help us to avoid manually typing `route` below
  const router = nuxtApp.$router

  // Wait for the `window.location.href` navigation from above to complete to avoid showing content. If that doesn't work fast enough, delegate navigation back to the `vue-router` (risking a vue-router 404 warning in the console, but still avoiding content-flashes of the protected target page)
  const waitForNavigationWithFallbackToRouter = new Promise(resolve => setTimeout(resolve, 60 * 1000))
    // @ts-expect-error router is `unknown` here, as it is not officially exposed
    .then(() => router.push(href))
  return waitForNavigationWithFallbackToRouter as Promise<void | undefined>
}

/** https://auth.sidebase.io/guide/application-side/configuration#baseurl */
export function resolveApiUrlPath(
  endpointPath: string,
  runtimeConfig: RuntimeConfig
): string {
  // Fully-specified endpoint path - do not join with `baseURL`
  if (isExternalUrl(endpointPath)) {
    return endpointPath
  }

  const baseURL = resolveApiBaseURL(runtimeConfig)
  return joinURL(baseURL, endpointPath)
}

export function resolveApiBaseURL(runtimeConfig: RuntimeConfig, returnOnlyPathname?: boolean): string {
  const authRuntimeConfig = runtimeConfig.public.auth

  // If the user has not specified `returnOnlyPathname`, infer it automatically.
  // When internal routing is enabled, drop everything except path.
  if (returnOnlyPathname === undefined) {
    returnOnlyPathname = !runtimeConfig.public.auth.disableInternalRouting
  }

  // Default to static runtime config (still overridable using `NUXT_PUBLIC_AUTH_BASE_URL`)
  let baseURL = authRuntimeConfig.baseURL

  // Note: the `server` condition is here because Nuxt explicitly filters out all the env variables for the Client build,
  // thus the check can be safely dropped. Instead of it, the `runtime/plugin` would set the `baseURL` on the runtime config.
  if (import.meta.server !== false && authRuntimeConfig.originEnvKey) {
    // Override base URL using environment variable specified in `originEnvKey` if any.
    // By default, would use `AUTH_ORIGIN`, can be changed by user
    const envBaseURL = process.env[authRuntimeConfig.originEnvKey]
    if (envBaseURL) {
      baseURL = envBaseURL
    }
  }

  if (returnOnlyPathname) {
    baseURL = withLeadingSlash(parseURL(baseURL).pathname)
  }

  return baseURL
}

/**
 * Naively checks if a URL is external or not by comparing against its protocol.
 *
 * URL being valid is not a concern for this function as it is used with developer-controlled inputs.
 */
export function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}
