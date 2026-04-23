import { ref } from 'vue';

export interface Config {
  // State
  current: any;
  permissions?: any[];
  oms: string;

  // Actions
  $reset?: () => void;
  postLogout: () => Promise<void>;
  preLogout: () => Promise<void>; // runs only in case when its manual logout and not unauth or invalid app context
  postLogin: () => Promise<void>;
  router: any;
}

export const accxuiConfig = ref<Config>({
  postLogin: () => Promise.resolve(),
  postLogout: () => Promise.resolve(),
  preLogout: () => Promise.resolve(),
  oms: "",
  current: {},
  router: ref(null)
});

export const initialiseConfig = (params: any) => {
  accxuiConfig.value = params
}
