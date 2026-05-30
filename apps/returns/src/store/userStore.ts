import { defineStore } from 'pinia'
import { api, commonUtil, logger, useAuth } from '@common'
import { maargApiKey } from '@/util/maargAuth'

export const useUserStore = defineStore('user', {
  state: () => ({
    current: null as any,
    oms: null as any,
    permissions: [] as string[],
  }),
  getters: {
    getUserProfile: (state) => state.current,
    getOms: (state) => state.oms,
    hasPermission: (state) => (permissionId: string): boolean => state.permissions.includes(permissionId),
  },
  actions: {
    setOms(oms: any) { this.oms = oms },
    async fetchUserProfile(): Promise<any> {
      try {
        // This Moqui build authenticates ONLY via the api_key header (Bearer JWT is not wired), so a
        // bare call 403s with "User [No User] is not authorized". Attach the key like omsAdapter does.
        const key = maargApiKey()
        const resp = await api({
          url: 'admin/user/profile', method: 'GET',
          baseURL: commonUtil.getMaargURL(),
          headers: key ? { api_key: key } : {},
        })
        if (commonUtil.hasError(resp)) throw 'Error getting user profile'
        this.current = resp.data
        useAuth().updateUserId(this.current.userId)
        return Promise.resolve(resp.data)
      } catch (error: any) {
        logger.error('fetchUserProfile failed', error)
        return Promise.reject(error)
      }
    },
    async postLogin() {
      await this.fetchUserProfile()
      this.setOms(commonUtil.getOmsURL())
    },
    async postLogout() { this.$reset() },
  },
  persist: true,
})
