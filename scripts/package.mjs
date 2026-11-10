import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = { ...JSON.parse(readFileSync(join(root, "frontend-package.json"), "utf8")), version: pkg.version };
const base = `/_frontend/${manifest.name}/${manifest.version}/`;
const dist = resolve(root, process.env.FRONTEND_DIST || "dist");
const output = resolve(root, process.env.FRONTEND_OUTPUT || "release");
if (!readFileSync(join(dist, "index.html"), "utf8").includes(base)) throw new Error(`Build must use asset base ${base}`);
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${pkg.version}`) throw new Error("Release tag must match package.json version");
writeFileSync(join(dist, "frontend.json"), JSON.stringify(manifest, null, 2) + "\n");
mkdirSync(output, { recursive: true });
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) files.push(relative(dist, path));
    else throw new Error(`Unsupported frontend entry: ${path}`);
  }
}
walk(dist);
const temporary = mkdtempSync(join(tmpdir(), "91-web-nostalgic-package-"));
try {
  const fileList = join(temporary, "files");
  writeFileSync(fileList, files.sort().join("\0") + "\0");
  const archive = join(output, "frontend.tar.gz");
  execFileSync("tar", ["--format=ustar", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--no-recursion", "-czf", archive, "-C", dist, "--null", "-T", fileList]);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(archive + ".sha256", `${digest}  frontend.tar.gz\n`);
  console.log(`Built ${manifest.name}@${manifest.version}: ${digest}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
