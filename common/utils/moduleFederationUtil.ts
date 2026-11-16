const useDynamicImport = ({ scope, module }: any) => {
  if (!module || !scope) return;

  const loadComponent = async () => {
    try {
      // The federation runtime loads on first use, so apps that never load a remote don't ship it.
      const { loadRemote } = await import('@module-federation/runtime');
      const { default: Component } = await loadRemote(`${scope}/${module}`) as any;
      return Component
    } catch (error) {
      console.error(`Error loading remote module ${scope}/${module}:`, error);
    }
  };

  return loadComponent();
}

export const moduleFederationUtil = {
  useDynamicImport
}
