import { covertStringToIterable } from "./convertStringToIterable.js";

export function convertStringToUint8Array(input: string): Uint8Array {
  const numbers = Array.from(covertStringToIterable(input))
    .filter((n) => n >= 0 && n <= 255);
  return new Uint8Array(numbers);
}