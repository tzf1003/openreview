import { Sandbox } from "@vercel/sandbox";

import { parseError } from "@/lib/error";

interface InstallDependenciesOptions {
  installProjectDependencies?: boolean;
}

const detectInstallCommand = async (
  sandbox: Sandbox
): Promise<{ args: string[]; cmd: string }> => {
  const checks = [
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "bun",
      lockfile: "bun.lock",
    },
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "pnpm",
      lockfile: "pnpm-lock.yaml",
    },
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "yarn",
      lockfile: "yarn.lock",
    },
  ];

  for (const { args, cmd, lockfile } of checks) {
    const result = await sandbox.runCommand("test", ["-f", lockfile]);
    if (result.exitCode === 0) {
      return { args, cmd };
    }
  }

  return { args: ["install"], cmd: "npm" };
};

export const installDependencies = async (
  sandboxId: string,
  options: InstallDependenciesOptions = {}
): Promise<void> => {
  "use step";

  let sandbox: Sandbox | null = null;

  try {
    sandbox = await Sandbox.get({ sandboxId });
  } catch (error) {
    throw new Error(
      `[installDependencies] Failed to get sandbox: ${parseError(error)}`,
      { cause: error }
    );
  }

  try {
    // Install GitHub CLI
    const ghInstall = await sandbox.runCommand("bash", [
      "-c",
      "command -v gh >/dev/null 2>&1 || (" +
        "curl -sLO https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.tar.gz &&" +
        " tar xzf gh_2.62.0_linux_amd64.tar.gz &&" +
        " mkdir -p ~/.local/bin &&" +
        " cp -f gh_2.62.0_linux_amd64/bin/gh ~/.local/bin/ &&" +
        " rm -rf gh_2.62.0_linux_amd64*)",
    ]);

    if (ghInstall.exitCode !== 0) {
      const stderr = await ghInstall.stderr();
      const stdout = await ghInstall.stdout();
      throw new Error(
        `Failed to install GitHub CLI (exit ${ghInstall.exitCode}): ${stderr || stdout}`
      );
    }

    if (options.installProjectDependencies === false) {
      return;
    }

    // Install project dependencies
    const { cmd, args } = await detectInstallCommand(sandbox);

    if (cmd !== "npm") {
      await sandbox.runCommand("npm", ["install", "-g", cmd]);
    }

    await sandbox.runCommand(cmd, args);
  } catch (error) {
    throw new Error(
      `Failed to install project dependencies: ${parseError(error)}`,
      { cause: error }
    );
  }
};
