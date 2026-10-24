/** heic-decode ships no types: the main image's pixels, RGBA. */
declare module "heic-decode" {
  export default function decode(input: {
    buffer: ArrayBufferLike | Uint8Array;
  }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}
