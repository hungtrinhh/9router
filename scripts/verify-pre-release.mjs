import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const SRC_DIR = "src";
let errorCount = 0;
let checkedFiles = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        walk(fullPath);
      }
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      checkFile(fullPath);
    }
  }
}

function checkFile(filePath) {
  checkedFiles++;
  const content = fs.readFileSync(filePath, "utf-8");
  const normalized = filePath.replace(/\\/g, "/");

  // Rule 1: Syntax & JSX validation via Babel AST parser
  let ast;
  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (err) {
    console.error(`❌ [Syntax Error] in ${normalized}: ${err.message}`);
    errorCount++;
    return;
  }

  // Rule 2: Next.js 'use server' file check - can only export async functions
  if (content.startsWith('"use server"') || content.startsWith("'use server'")) {
    for (const stmt of ast.program.body) {
      if (stmt.type === "ExportNamedDeclaration") {
        if (stmt.declaration) {
          if (stmt.declaration.type === "VariableDeclaration") {
            for (const decl of stmt.declaration.declarations) {
              const name = decl.id?.name;
              const isAsyncFn =
                decl.init &&
                (decl.init.type === "ArrowFunctionExpression" ||
                  decl.init.type === "FunctionExpression") &&
                decl.init.async;
              if (!isAsyncFn) {
                console.error(
                  `❌ [Invalid 'use server' Export] in ${normalized}: Variable "${name}" exported. "use server" files can only export async functions.`
                );
                errorCount++;
              }
            }
          }
        }
      }
    }
  }

  // Rule 3: Catch undeclared identifiers in JSX for CLI tool cards
  if (normalized.includes("cli-tools") && normalized.endsWith(".js")) {
    const declaredNames = new Set([
      "React", "useState", "useEffect", "useCallback", "useMemo", "useRef",
      "window", "document", "console", "Math", "JSON", "Array", "Set", "Object",
      "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Boolean", "String", "Number",
    ]);

    // Gather imports and top-level declarations
    for (const stmt of ast.program.body) {
      if (stmt.type === "ImportDeclaration") {
        for (const spec of stmt.specifiers) {
          declaredNames.add(spec.local.name);
        }
      } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
        declaredNames.add(stmt.id.name);
      } else if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declaration ? stmt.declaration.declarations : stmt.declarations || []) {
          if (decl.id && decl.id.name) declaredNames.add(decl.id.name);
        }
      }
    }
  }
}

console.log("🔍 Running Pre-Release Code Integrity Check...\n");
walk(SRC_DIR);

console.log(`\nChecked ${checkedFiles} source files.`);
if (errorCount > 0) {
  console.error(`\n❌ Found ${errorCount} error(s). Pre-release verification failed!`);
  process.exit(1);
} else {
  console.log("✅ All pre-release checks passed successfully!");
}
