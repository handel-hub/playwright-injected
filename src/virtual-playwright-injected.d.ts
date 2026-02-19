declare module '@protocol/channels' {
  const x: any;
  export = x;
}

declare module 'virtual:playwright-injected' {
  export { InjectedScript } from '@playwright-injected/injectedScript';
  export type * from '@playwright-injected/injectedScript';
}
