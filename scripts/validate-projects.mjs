import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const projects = [
  {
    root: "bots/quick-map",
    required: [
      "index.html",
      "api/chat.js",
      "assets/Trade-Accelerator-Logo.webp",
      "assets/faviconta.png",
      "package.json",
      "vercel.json"
    ],
    checkJavaScript: ["api/chat.js"]
  },
  {
    root: "pages/crs-roofing",
    required: [
      "index.html",
      "assets/crs-logo.png",
      "assets/felt.jpg",
      "assets/luxury-roof-background.jpg",
      "assets/pan-tile.jpg",
      "assets/plain-tile.jpg",
      "assets/roof-footprint.png",
      "assets/roof-height.png",
      "assets/slate.jpg",
      ".env.example",
      "api/enquiry.js",
      "package.json",
      "vercel.json"
    ],
    checkJavaScript: ["api/enquiry.js"]
  }
];

const errors = [];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function localAssetReferences(html) {
  const references = new Set();
  const patterns = [
    /(?:src|href)=["']([^"'#]+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const reference = match[1].trim();

      if (
        !reference ||
        reference.startsWith("http://") ||
        reference.startsWith("https://") ||
        reference.startsWith("data:") ||
        reference.startsWith("mailto:") ||
        reference.startsWith("tel:") ||
        reference.startsWith("/api/") ||
        reference.includes("$") ||
        reference === "blob" ||
        reference === "url"
      ) {
        continue;
      }

      references.add(reference.split("?")[0]);
    }
  }

  return references;
}

for (const project of projects) {
  const projectRoot = path.join(repositoryRoot, project.root);

  for (const relativePath of project.required) {
    const filePath = path.join(projectRoot, relativePath);
    if (!(await exists(filePath))) {
      errors.push(`Missing required file: ${project.root}/${relativePath}`);
    }
  }

  const htmlPath = path.join(projectRoot, "index.html");
  if (await exists(htmlPath)) {
    const html = await readFile(htmlPath, "utf8");

    for (const reference of localAssetReferences(html)) {
      const relativeReference = reference.startsWith("/")
        ? reference.slice(1)
        : reference;
      const assetPath = path.join(projectRoot, relativeReference);

      if (!(await exists(assetPath))) {
        errors.push(
          `Broken local asset reference in ${project.root}/index.html: ${reference}`
        );
      }
    }
  }

  for (const relativePath of project.checkJavaScript) {
    const result = spawnSync(
      process.execPath,
      ["--check", path.join(projectRoot, relativePath)],
      { encoding: "utf8" }
    );

    if (result.status !== 0) {
      errors.push(
        `JavaScript syntax error in ${project.root}/${relativePath}:\n${result.stderr.trim()}`
      );
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log("All Trade Accelerator projects passed validation.");
