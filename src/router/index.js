import { createRouter, createWebHistory } from 'vue-router'
import OpenSeadragonTest from '../views/OpenSeadragonTest.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: OpenSeadragonTest,
    },
  ],
})

export default router
