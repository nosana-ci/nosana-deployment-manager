export function createState<T>(initialValue?: T): State<T> {
  let value = initialValue as T;
  return {
    get: () => value,
    set: (v: T) => { value = v; }
  };
}

export type State<T> = {
  get: () => T;
  set: (v: T) => void;
};