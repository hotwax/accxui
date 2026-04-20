import { ref } from 'vue';

export interface Config {
  // State
  current: any;
  permissions?: any[];
  oms: string;

  // Actions
  fetchUserProfile?: () => Promise<void>;
  fetchPermissions?: () => Promise<void>;
  $reset?: () => void;
  postLogout: () => Promise<void>;
  postLogin: () => Promise<void>;
  router: any;
}

export const accxuiConfig = ref<Config>({
  postLogin: () => Promise.resolve(),
  postLogout: () => Promise.resolve(),
  oms: "",
  current: {},
  router: ref(null)
});

export const initialiseConfig = (params: any) => {
  accxuiConfig.value = params
}
