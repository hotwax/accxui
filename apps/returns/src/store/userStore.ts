import { defineStore } from 'pinia'
import { api, commonUtil, logger, useAuth } from '@common'

export const useUserStore = defineStore('user', {
  state: () => ({
    current: null as any,
    oms: null as any,
  }),
  getters: {
    getUserProfile: (state) => state.current,
    getOms: (state) => state.oms,
  },
  actions: {
    async setOms(oms: any) { this.oms = oms },
    async fetchUserProfile(): Promise<any> {
      try {
        const resp = await api({ url: 'admin/user/profile', method: 'GET', baseURL: commonUtil.getMaargURL() })
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
      await this.setOms(commonUtil.getOmsURL())
    },
    async postLogout() { this.$reset() },
  },
  persist: true,
})
