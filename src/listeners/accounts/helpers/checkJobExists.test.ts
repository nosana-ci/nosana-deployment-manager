import { describe, it, expect, vi } from "vitest";
import type { Job, NosanaClient } from "@nosana/kit";
import { address } from "@solana/addresses";

import { checkJobExists } from "./checkJobExists.js";

const JOB = "33333333333333333333333333333333333333333333";

const kitWith = (get: ReturnType<typeof vi.fn>) =>
  ({ jobs: { get } }) as unknown as NosanaClient;

/** A SolanaError carrying `context.__code`, as @solana/accounts throws. */
const solanaError = (code: number) => {
  const error = new Error(`solana error #${code}`) as Error & { context: { __code: number } };
  error.name = "SolanaError";
  error.context = { __code: code };
  return error;
};

describe("checkJobExists", () => {
  it("returns true when the job account is fetched", async () => {
    const get = vi.fn().mockResolvedValue({ address: address(JOB) } as Job);

    await expect(checkJobExists(kitWith(get), JOB)).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(address(JOB));
  });

  it("returns false when the account is not found (#3230000)", async () => {
    const get = vi.fn().mockRejectedValue(solanaError(3230000));

    await expect(checkJobExists(kitWith(get), JOB)).resolves.toBe(false);
  });

  it("returns false for the multi-account not-found code (#32300001)", async () => {
    const get = vi.fn().mockRejectedValue(solanaError(32300001));

    await expect(checkJobExists(kitWith(get), JOB)).resolves.toBe(false);
  });

  it("detects a not-found code nested in the cause chain", async () => {
    const wrapper = new Error("wrapped") as Error & { cause: unknown };
    wrapper.cause = solanaError(3230000);
    const get = vi.fn().mockRejectedValue(wrapper);

    await expect(checkJobExists(kitWith(get), JOB)).resolves.toBe(false);
  });

  it("re-throws transient/transport errors instead of reporting 'gone'", async () => {
    const get = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(checkJobExists(kitWith(get), JOB)).rejects.toThrow("fetch failed");
  });

  it("re-throws unrelated Solana errors (a different __code)", async () => {
    const get = vi.fn().mockRejectedValue(solanaError(-32005)); // node unhealthy

    await expect(checkJobExists(kitWith(get), JOB)).rejects.toThrow();
  });
});
