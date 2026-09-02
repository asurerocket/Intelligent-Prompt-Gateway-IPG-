import * as fs from "fs";
import * as path from "path";
import Module = require("module");

interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
}

const tests: TestCase[] = [];
const suiteStack: string[] = [];

function collectTestFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.endsWith(".test.js") || entry.name.endsWith(".integration.test.js")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

async function run(): Promise<void> {
  const originalLoad = (Module as unknown as { _load: (request: string, parent: NodeJS.Module | null, isMain: boolean) => unknown })._load;
  (Module as unknown as { _load: (request: string, parent: NodeJS.Module | null, isMain: boolean) => unknown })._load = (
    request: string,
    parent: NodeJS.Module | null,
    isMain: boolean
  ): unknown => {
    if (request === "vscode") {
      return {
        workspace: {
          workspaceFolders: undefined,
          getConfiguration: () => ({ get: <T>(_key: string, defaultValue: T): T => defaultValue })
        },
        window: {
          showWarningMessage: () => undefined,
          showInformationMessage: () => undefined,
          showErrorMessage: () => undefined
        },
        Uri: {
          file: (value: string) => ({ fsPath: value })
        }
      };
    }
    return originalLoad(request, parent, isMain);
  };

  (globalThis as unknown as { suite: (name: string, fn: () => void) => void }).suite = (name: string, fn: () => void): void => {
    suiteStack.push(name);
    try {
      fn();
    } finally {
      suiteStack.pop();
    }
  };

  (globalThis as unknown as { test: (name: string, fn: () => void | Promise<void>) => void }).test = (
    name: string,
    fn: () => void | Promise<void>
  ): void => {
    tests.push({
      suite: suiteStack.join(" > "),
      name,
      fn
    });
  };

  const outDir = path.resolve(__dirname, "..");
  const testFiles = collectTestFiles(outDir).filter((file) => !file.endsWith(path.join("test", "runTest.js")));

  if (testFiles.length === 0) {
    console.error("No compiled test files found in out/. Ensure compile-tests ran successfully.");
    process.exit(1);
    return;
  }

  for (const file of testFiles) {
    const source = fs.readFileSync(file, "utf8");
    if (source.includes('require("vscode")') || source.includes("require('vscode')")) {
      // These suites require VS Code extension host runtime and should run in integration host tests.
      continue;
    }
    require(file);
  }

  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      process.stdout.write(`PASS  ${item.suite} :: ${item.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL  ${item.suite} :: ${item.name}\n`);
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    }
  }

  process.stdout.write(`\nExecuted ${tests.length} test(s).\n`);
  (Module as unknown as { _load: (request: string, parent: NodeJS.Module | null, isMain: boolean) => unknown })._load = originalLoad;
  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
