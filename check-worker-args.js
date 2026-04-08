const idx = process.argv.indexOf("--worker");
const value = idx >= 0 ? process.argv[idx + 1] : undefined;

if (value !== "opencode") {
  process.exit(42);
}
