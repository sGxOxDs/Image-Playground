import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COAUTHOR = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_TITLE_PATTERN = /^web-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-dev\+([1-9]\d*))?$/;
const SOURCE_COMMIT_PATTERN = /(?:^|\n)Source-Commit:\s*([0-9a-f]{40}|[0-9a-f]{64})\s*(?:\n|$)/;
const PUBLISHED_ASSET_EXCLUDES = [
  ":(exclude)assets/**",
  ":(exclude)index.html",
  ":(exclude)sw.js",
  ":(exclude)_.data",
  ":(exclude)favicon.ico",
  ":(exclude).nojekyll",
  ":(exclude)workspace/**",
];

export function parseReleaseTitle(subject) {
  const match = VERSION_TITLE_PATTERN.exec(subject);
  if (!match) return undefined;
  return {
    version: match[1],
    devNumber: match[2] ? Number(match[2]) : undefined,
  };
}

export function compareVersions(left, right) {
  const leftParts = VERSION_PATTERN.exec(left);
  const rightParts = VERSION_PATTERN.exec(right);
  if (!leftParts || !rightParts) throw new Error("版本必須符合 X.Y.Z 格式");
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function assertNewerStableVersion(candidate, current) {
  if (!VERSION_PATTERN.test(candidate) || compareVersions(candidate, current) <= 0) {
    throw new Error(`正式版號必須大於目前版本 ${current}`);
  }
}

export function findLatestStable(releases) {
  return releases.find((release) => {
    const parsed = parseReleaseTitle(release.subject);
    return parsed && parsed.devNumber === undefined;
  });
}

export function nextDevelopmentTitle(releases) {
  const stableIndex = releases.findIndex((release) => {
    const parsed = parseReleaseTitle(release.subject);
    return parsed && parsed.devNumber === undefined;
  });
  if (stableIndex < 0) throw new Error("gh-pages 找不到 web-X.Y.Z 正式版，無法決定測試版號");

  const stable = parseReleaseTitle(releases[stableIndex].subject);
  const latestDev = releases
    .slice(0, stableIndex)
    .map((release) => {
      const parsed = parseReleaseTitle(release.subject);
      return parsed?.version === stable.version && parsed.devNumber !== undefined
        ? parsed.devNumber
        : undefined;
    })
    .find((number) => number !== undefined) ?? 0;
  return `web-${stable.version}-dev+${latestDev + 1}`;
}

export function releaseBaseline(release, body) {
  const sourceCommit = SOURCE_COMMIT_PATTERN.exec(body)?.[1];
  return sourceCommit
    ? { kind: "source", ref: sourceCommit }
    : { kind: "snapshot", ref: release.hash };
}

export function formatReleaseBody({ previousVersion, subjects, changes, sourceCommit }) {
  const lines = [`- 更新摘要（${previousVersion} 至本次版本）`];
  const uniqueSubjects = [...new Set(subjects)].filter(Boolean);
  if (uniqueSubjects.length) {
    lines.push(...uniqueSubjects.map((subject) => `  - ${subject}`));
  }
  if (changes.length) {
    lines.push("- 差異檔案：");
    lines.push(...changes.map((change) => `  - ${change}`));
  } else if (!uniqueSubjects.length) {
    lines.push("  - 無原始碼差異");
  }
  lines.push("", `Source-Commit: ${sourceCommit}`, "", COAUTHOR);
  return lines.join("\n");
}

function git(args, { cwd, capture = false } = {}) {
  const result = spawnSync("git", ["--no-pager", ...args], {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : "";
    throw new Error(`git ${args[0]} 失敗${detail ? `：${detail}` : ""}`);
  }
  return capture ? result.stdout.trim() : "";
}

function getReleases(root) {
  const output = git(["log", "--format=%H%x09%s", "origin/gh-pages"], {
    cwd: root,
    capture: true,
  });
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("\t");
    return { hash: line.slice(0, separator), subject: line.slice(separator + 1) };
  });
}

function getCommitBody(root, hash) {
  return git(["show", "-s", "--format=%B", hash], { cwd: root, capture: true });
}

function getSourceCommit(root) {
  return git(["rev-parse", "HEAD"], { cwd: root, capture: true });
}

function hasCleanSourceTree(root) {
  return git(["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    capture: true,
  }).length === 0;
}

function buildStatic(projectRoot) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmCli ? [npmCli, "run", "build:static"] : ["run", "build:static"];
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("靜態網站建置失敗");
}

function toDiffEntries(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, firstPath, secondPath] = line.split("\t");
    if (status.startsWith("A")) return `新增 ${firstPath}`;
    if (status.startsWith("D")) return `刪除 ${firstPath}`;
    if (status.startsWith("R")) return `重新命名 ${firstPath} → ${secondPath}`;
    return `修改 ${firstPath}`;
  });
}

function getReleaseChanges(root, baseline, sourceCommit, hasSourceBaseline) {
  const changes = git([
    "diff", "--name-status", "--find-renames", baseline, sourceCommit, "--", ".",
    ...PUBLISHED_ASSET_EXCLUDES,
  ], { cwd: root, capture: true });
  const subjects = !hasSourceBaseline || baseline === sourceCommit
    ? []
    : git(["log", "--no-merges", "--format=%s", "--reverse", `${baseline}..${sourceCommit}`], {
      cwd: root,
      capture: true,
    }).split(/\r?\n/).filter(Boolean);
  return { changes: toDiffEntries(changes), subjects };
}

async function publish(mode, requestedVersion) {
  const projectRoot = path.dirname(fileURLToPath(import.meta.url));
  const root = git(["rev-parse", "--show-toplevel"], { cwd: projectRoot, capture: true });
  if (mode === "stable" && !VERSION_PATTERN.test(requestedVersion ?? "")) {
    throw new Error("正式版請提供 X.Y.Z 版號，例如 npm run publish:pages -- 0.0.6");
  }

  git(["fetch", "origin", "gh-pages"], { cwd: root });
  const releases = getReleases(root);
  const latestStable = findLatestStable(releases);
  if (!latestStable) throw new Error("origin/gh-pages 找不到 web-X.Y.Z 正式版");

  let title;
  let body;
  const sourceCommit = getSourceCommit(root);
  if (mode === "dev") {
    title = nextDevelopmentTitle(releases);
    body = `- 開發測試版\n\nSource-Commit: ${sourceCommit}\n\n${COAUTHOR}`;
  } else {
    const latestVersion = parseReleaseTitle(latestStable.subject).version;
    assertNewerStableVersion(requestedVersion, latestVersion);
    if (!hasCleanSourceTree(root)) {
      throw new Error("正式版發布需要乾淨的來源工作目錄，請先提交或暫存所有變更");
    }

    title = `web-${requestedVersion}`;
    const baseline = releaseBaseline(latestStable, getCommitBody(root, latestStable.hash));
    const { changes, subjects } = getReleaseChanges(
      root,
      baseline.ref,
      sourceCommit,
      baseline.kind === "source",
    );
    body = formatReleaseBody({
      previousVersion: latestVersion,
      subjects,
      changes,
      sourceCommit,
    });
  }

  buildStatic(projectRoot);
  const client = path.join(projectRoot, "build-static", "client");
  if (!(await stat(client)).isDirectory()) throw new Error(`找不到靜態建置輸出：${client}`);

  const worktree = await mkdtemp(path.join(os.tmpdir(), "image-playground-pages-"));
  let worktreeAdded = false;
  try {
    git(["worktree", "add", "--detach", worktree, "origin/gh-pages"], { cwd: root });
    worktreeAdded = true;
    for (const name of await readdir(client)) {
      await cp(path.join(client, name), path.join(worktree, name), {
        recursive: true,
        force: true,
      });
    }
    await writeFile(path.join(worktree, ".nojekyll"), "");
    git(["add", "--all"], { cwd: worktree });
    git(["commit", "--allow-empty", "-m", title, "-m", body], { cwd: worktree });
    git(["push", "origin", "HEAD:gh-pages"], { cwd: worktree });
    console.log(`已發布 ${title} 至 origin/gh-pages`);
  } finally {
    if (worktreeAdded) git(["worktree", "remove", "--force", worktree], { cwd: root });
    else await rm(worktree, { recursive: true, force: true });
  }
}

async function main(args) {
  const [mode, version, ...extra] = args;
  if (extra.length || !["dev", "stable"].includes(mode) || (mode === "dev" && version)) {
    throw new Error("用法：npm run devlop，或 npm run publish:pages -- X.Y.Z");
  }
  await publish(mode, version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
