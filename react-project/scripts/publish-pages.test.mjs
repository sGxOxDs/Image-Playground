import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNewerStableVersion,
  compareVersions,
  findLatestStable,
  formatReleaseBody,
  nextDevelopmentTitle,
  parseReleaseTitle,
  releaseBaseline,
} from "./publish-pages.mjs";

test("development version increments after the latest stable release", () => {
  const releases = [
    { subject: "web-0.0.5-dev+3" },
    { subject: "web-0.0.5-dev+1" },
    { subject: "web-0.0.5" },
    { subject: "web-0.0.4-dev+9" },
    { subject: "initial deployment" },
  ];
  assert.equal(nextDevelopmentTitle(releases), "web-0.0.5-dev+4");
});

test("development version restarts after a new stable release", () => {
  assert.equal(nextDevelopmentTitle([
    { subject: "web-0.0.6" },
    { subject: "web-0.0.5-dev+4" },
    { subject: "web-0.0.5" },
  ]), "web-0.0.6-dev+1");
});

test("development version increments the most recently published number", () => {
  assert.equal(nextDevelopmentTitle([
    { subject: "web-0.0.5-dev+2" },
    { subject: "web-0.0.5-dev+9" },
    { subject: "web-0.0.5" },
  ]), "web-0.0.5-dev+3");
});

test("development version requires an existing stable release", () => {
  assert.throws(() => nextDevelopmentTitle([{ subject: "web-0.0.5-dev+1" }]), /找不到/);
});

test("stable release lookup ignores development releases", () => {
  const stable = { hash: "stable-hash", subject: "web-0.0.5" };
  assert.equal(findLatestStable([
    { hash: "dev-hash", subject: "web-0.0.5-dev+2" },
    stable,
  ]), stable);
});

test("versions compare by numeric components", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.throws(() => compareVersions("1.0", "1.0.0"), /X\.Y\.Z/);
  assert.doesNotThrow(() => assertNewerStableVersion("0.0.6", "0.0.5"));
  assert.throws(() => assertNewerStableVersion("0.0.5", "0.0.5"), /大於目前版本/);
  assert.throws(() => assertNewerStableVersion("bad", "0.0.5"), /大於目前版本/);
});

test("stable release diff falls back to the last release snapshot until a source SHA exists", () => {
  assert.deepEqual(releaseBaseline({ hash: "pages-hash" }, "legacy release body"), {
    kind: "snapshot",
    ref: "pages-hash",
  });
  assert.deepEqual(releaseBaseline({ hash: "pages-hash" }, `Source-Commit: ${"a".repeat(40)}`), {
    kind: "source",
    ref: "a".repeat(40),
  });
});

test("release body lists source commits, changed files, source SHA, and co-author", () => {
  const body = formatReleaseBody({
    previousVersion: "0.0.5",
    subjects: ["新增測試功能"],
    changes: ["修改 react-project/app/routes/home.tsx"],
    sourceCommit: "a".repeat(40),
  });
  assert.match(body, /新增測試功能/);
  assert.match(body, /修改 react-project\/app\/routes\/home\.tsx/);
  assert.match(body, /Source-Commit: a{40}/);
  assert.match(body, /Co-authored-by: Copilot/);
});

test("release title parser accepts only stable and development release formats", () => {
  assert.deepEqual(parseReleaseTitle("web-1.2.3-dev+4"), { version: "1.2.3", devNumber: 4 });
  assert.deepEqual(parseReleaseTitle("web-1.2.3"), { version: "1.2.3", devNumber: undefined });
  assert.equal(parseReleaseTitle("web-01.2.3"), undefined);
});
