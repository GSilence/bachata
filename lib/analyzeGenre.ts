import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

export interface GenreAnalysisResult {
  is_bachata_compatible: boolean;
  confidence: number;
  genre_hint: string;
  checks_passed: number;
  total_checks: number;
  details: Record<string, boolean>;
  features: Record<string, number>;
}

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key && valueParts.length > 0) {
            const value = valueParts
              .join("=")
              .trim()
              .replace(/^["']|["']$/g, "");
            process.env[key.trim()] = value;
          }
        }
      }
    } catch {}
  }
}

export async function analyzeGenre(
  audioPath: string
): Promise<GenreAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const scriptPath = join(process.cwd(), "scripts", "analyze-genre.py");
  if (!existsSync(scriptPath)) {
    throw new Error(`Genre analysis script not found: ${scriptPath}`);
  }

  loadEnvLocal();

  let pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
  pythonPath = pythonPath.trim().replace(/^["']|["']$/g, "");

  const command = `"${pythonPath}" "${scriptPath}" "${audioPath}"`;

  console.log("[Genre] Running:", command);

  const { stdout, stderr } = await execAsync(command, {
    maxBuffer: 5 * 1024 * 1024,
    timeout: 120000,
  });

  if (stderr) {
    console.log("[Genre] stderr:", stderr);
  }

  const result = JSON.parse(stdout.trim());

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}
