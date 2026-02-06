import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { requireAdmin } from "@/lib/auth";

const CONFIG_PATH = join(process.cwd(), "config", "analysis-thresholds.json");

const DEFAULT_CONFIG = {
  bridge: { low: 0.30, high: 0.80 },
  break: { low: 1.20, high: 1.85 },
  trim_seconds: 15.0,
};

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.warn("Failed to read thresholds config:", e);
  }
  return DEFAULT_CONFIG;
}

export async function GET() {
  const config = readConfig();
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Валидация с корректной обработкой 0 и NaN
    const parseNum = (val: unknown, fallback: number): number => {
      const n = Number(val);
      return Number.isNaN(n) ? fallback : n;
    };

    const config = {
      bridge: {
        low: Math.max(0, Math.min(1, parseNum(body.bridge?.low, 0.30))),
        high: Math.max(0, Math.min(1, parseNum(body.bridge?.high, 0.80))),
      },
      break: {
        low: Math.max(1, Math.min(3, parseNum(body.break?.low, 1.20))),
        high: Math.max(1, Math.min(3, parseNum(body.break?.high, 1.85))),
      },
      trim_seconds: Math.max(0, Math.min(60, parseNum(body.trim_seconds, 15.0))),
    };

    // Проверка: low < high
    if (config.bridge.low >= config.bridge.high) {
      return NextResponse.json(
        { error: "Bridge low must be less than high" },
        { status: 400 }
      );
    }
    if (config.break.low >= config.break.high) {
      return NextResponse.json(
        { error: "Break low must be less than high" },
        { status: 400 }
      );
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    return NextResponse.json({ success: true, config });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
