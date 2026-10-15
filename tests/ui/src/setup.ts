/**
 * Logs the browser in once, as a shared test user (the e2e stack runs auth with
 * AUTH_TEST_USERS), and saves the session cookies for every test to start from. Tests about being
 * logged out opt out with an empty storage state.
 */
import { request, type FullConfig } from "@playwright/test";

export const STATE = "test-results/.session.json";

export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/v1/login", { data: { email: "ui@test.local" } });
  if (!response.ok()) throw new Error(`logging in failed: ${response.status()}`);
  await context.storageState({ path: STATE });
  await context.dispose();
}
