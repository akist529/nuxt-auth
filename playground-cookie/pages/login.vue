<script lang="ts" setup>
import { ref } from 'vue'
import { definePageMeta, useAuth } from '#imports'

const { signIn, token, data, status, lastRefreshedAt } = useAuth()

const username = ref('')
const userid = ref('')
const password = ref('')

definePageMeta({
  auth: {
    unauthenticatedOnly: true,
    navigateAuthenticatedTo: '/'
  }
})
</script>

<template>
  <div>
    <h1>Login Page</h1>
    <pre>Status: {{ status }}</pre>
    <pre>Data: {{ data || 'no session data present, are you logged in?' }}</pre>
    <pre>Last refreshed at: {{ lastRefreshedAt || 'no refresh happened' }}</pre>
    <pre>JWT token: {{ token || 'no token present, are you logged in?' }}</pre>
    <form @submit.prevent="signIn({ username, userid, password })">
      <input v-model="username" type="email" placeholder="Email">
      <input v-model="userid" type="text" placeholder="Username">
      <input v-model="password" type="password" placeholder="Password">
      <button type="submit">
        sign in
      </button>
    </form>
  </div>
</template>
