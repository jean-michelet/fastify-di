export type Exact<A, B> = A extends B
  ? Exclude<keyof B, keyof A> extends never
    ? B
    : never
  : never;
