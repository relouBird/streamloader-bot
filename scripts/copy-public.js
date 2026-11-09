const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(__dirname, "..", "src", "public");
const destination = path.resolve(__dirname, "..", "dist", "public");
const assetsSource = path.resolve(__dirname, "..", "src", "assets");
const assetsDestination = path.resolve(__dirname, "..", "dist", "assets");

if (!fs.existsSync(source)) {
  throw new Error(`Public assets directory not found: ${source}`);
}

fs.cpSync(source, destination, { recursive: true });
console.log(`Copied public assets to ${destination}`);

if (fs.existsSync(assetsSource)) {
  fs.cpSync(assetsSource, assetsDestination, { recursive: true });
  console.log(`Copied bot assets to ${assetsDestination}`);
}
