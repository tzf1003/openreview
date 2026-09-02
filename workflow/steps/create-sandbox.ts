import { Sandbox } from "@vercel/sandbox";

import { downloadRepositoryArchive } from "@/lib/github";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SOURCE_ARCHIVE_PATH = ".openreview-source.tar.gz";

const runCommand = async (
  sandbox: Sandbox,
  command: string,
  args: string[]
): Promise<void> => {
  const result = await sandbox.runCommand(command, args);
  if (result.exitCode === 0) {
    return;
  }

  const output = await result.output("both");
  throw new Error(
    `${command} failed with exit code ${result.exitCode}: ${output.trim()}`
  );
};

const initializeRepository = async (
  sandbox: Sandbox,
  repoFullName: string
): Promise<void> => {
  await runCommand(sandbox, "git", ["init", "--quiet"]);
  await runCommand(sandbox, "git", ["config", "user.name", "openreview[bot]"]);
  await runCommand(sandbox, "git", [
    "config",
    "user.email",
    "openreview[bot]@users.noreply.github.com",
  ]);
  await runCommand(sandbox, "git", ["config", "core.hooksPath", "/dev/null"]);
  await runCommand(sandbox, "git", [
    "remote",
    "add",
    "origin",
    `https://github.com/${repoFullName}.git`,
  ]);
  await runCommand(sandbox, "git", ["add", "-A"]);
  await runCommand(sandbox, "git", [
    "commit",
    "--no-verify",
    "--quiet",
    "-m",
    "Xsec Review source snapshot",
  ]);
};

const populateSandbox = async (
  sandbox: Sandbox,
  archive: Buffer,
  repoFullName: string
): Promise<void> => {
  await sandbox.writeFiles([{ content: archive, path: SOURCE_ARCHIVE_PATH }]);
  await runCommand(sandbox, "tar", [
    "-xzf",
    SOURCE_ARCHIVE_PATH,
    "--strip-components=1",
  ]);
  await runCommand(sandbox, "rm", [SOURCE_ARCHIVE_PATH]);
  await initializeRepository(sandbox, repoFullName);
};

export const createSandbox = async (
  repoFullName: string,
  revision: string
): Promise<string> => {
  "use step";

  try {
    const archive = await downloadRepositoryArchive(repoFullName, revision);
    const sandbox = await Sandbox.create({ timeout: FIVE_MINUTES_MS });
    await populateSandbox(sandbox, archive, repoFullName);
    return sandbox.sandboxId;
  } catch (error) {
    throw new Error("Failed to create a credential-free sandbox", {
      cause: error,
    });
  }
};
