import assert from "node:assert/strict";
import test from "node:test";
import { getGitHubAppConfig } from "../src/lib/github-app-auth";

test("GitHub App configuration remains optional for public repositories", () => {
  assert.equal(getGitHubAppConfig({}), undefined);
});

test("GitHub App rejects partial credential configuration", () => {
  assert.throws(() => getGitHubAppConfig({ GITHUB_APP_ID: "123" }), /配置不完整/);
});
