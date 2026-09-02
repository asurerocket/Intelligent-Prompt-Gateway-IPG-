import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ContextBuilder } from "./contextBuilder";

suite("ContextBuilder", () => {
  test("builds focused context pack from relevant files", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "rocket-context-"));
    const authPath = path.join(folder, "auth.ts");
    const jwtPath = path.join(folder, "jwt.ts");
    const loggerPath = path.join(folder, "logger.ts");

    await fs.writeFile(authPath, "export function authenticateUser(token: string) { return token.length > 0; }\n", "utf8");
    await fs.writeFile(jwtPath, "export const verifyJwt = (jwt: string) => jwt.includes('.');\n", "utf8");
    await fs.writeFile(loggerPath, "export const log = (message: string) => message;\n", "utf8");

    const builder = new ContextBuilder();
    const pack = await builder.build(folder, "explain authentication flow");

    assert.ok(pack.selectedFiles.some((file) => file.includes("auth.ts")));
    assert.ok(pack.selectedFiles.some((file) => file.includes("jwt.ts")));
    assert.ok(pack.breakdown.originalTokens >= pack.breakdown.optimizedTokens);
  });
});
