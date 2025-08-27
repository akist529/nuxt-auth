export default defineNuxtConfig({
  // ssr: false,
  compatibilityDate: '2024-04-03',
  modules: ['../src/module.ts'],
  build: {
    transpile: ['jsonwebtoken']
  },
  auth: {
    baseURL: '/api',
    provider: {
      type: 'cookie',
      cookie: {
        name: 'ty_retailers_session',
      },
      csrf: {
        cookie_name: 'XSRF-TOKEN', header_name: 'X-XSRF-TOKEN', methods: ['delete', 'post', 'put'],
        csrf: { cookie_name: 'XSRF-TOKEN', header_name: 'X-XSRF-TOKEN', methods: ['delete', 'post', 'put'] }
      },
      endpoints: {
        getSession: { path: '/user' },
        csrf: { path: '/sanctum/csrf-cookie' },
      },
      pages: {
        login: '/'
      },
      sessionDataType: {},
    },
    session: {
      // Where to refresh the session every time the browser window is refocused.
      enableRefreshOnWindowFocus: true,
      // Whether to refresh the session every `X` milliseconds. Set this to `false` to turn it off. The session will only be refreshed if a session already exists.
      enableRefreshPeriodically: false // 5000
    },
    globalAppMiddleware: {
      isEnabled: true
    }
  },
  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost/api',
        changeOrigin: true,
      }
    }
  }
  // routeRules: {
  //   '/with-caching': {
  //     swr: 86400000,
  //     auth: {
  //       disableServerSideAuth: true
  //     }
  //   }
  // }
})
