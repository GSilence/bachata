"use client";

import { useState, useEffect } from "react";

interface ThresholdConfig {
  bridge: { low: number; high: number };
  break: { low: number; high: number };
  trim_seconds: number;
  confirm_beats: number;
}

export default function ThresholdSettings() {
  const [config, setConfig] = useState<ThresholdConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/settings/thresholds")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/settings/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data.config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Безопасный парсинг числа - сохраняем текущее значение при невалидном вводе
  const safeParseFloat = (value: string, current: number): number => {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? current : parsed;
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>;
  if (!config) return null;

  return (
    <div className="bg-gray-800 rounded-lg p-4 text-sm">
      <h3 className="text-gray-300 font-medium mb-3">Energy Thresholds</h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Bridge */}
        <div className="space-y-2">
          <div className="text-yellow-400 text-xs font-medium">Bridge (quiet)</div>
          <div className="flex items-center gap-2">
            <label className="text-gray-500 text-xs w-8">Low:</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={config.bridge.low}
              onChange={(e) =>
                setConfig({
                  ...config,
                  bridge: { ...config.bridge, low: safeParseFloat(e.target.value, config.bridge.low) },
                })
              }
              className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            />
            <span className="text-gray-500 text-xs">({Math.round(config.bridge.low * 100)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-500 text-xs w-8">High:</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={config.bridge.high}
              onChange={(e) =>
                setConfig({
                  ...config,
                  bridge: { ...config.bridge, high: safeParseFloat(e.target.value, config.bridge.high) },
                })
              }
              className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            />
            <span className="text-gray-500 text-xs">({Math.round(config.bridge.high * 100)}%)</span>
          </div>
        </div>

        {/* Break */}
        <div className="space-y-2">
          <div className="text-orange-400 text-xs font-medium">Break (loud)</div>
          <div className="flex items-center gap-2">
            <label className="text-gray-500 text-xs w-8">Low:</label>
            <input
              type="number"
              step="0.05"
              min="1"
              max="3"
              value={config.break.low}
              onChange={(e) =>
                setConfig({
                  ...config,
                  break: { ...config.break, low: safeParseFloat(e.target.value, config.break.low) },
                })
              }
              className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            />
            <span className="text-gray-500 text-xs">({Math.round(config.break.low * 100)}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-500 text-xs w-8">High:</label>
            <input
              type="number"
              step="0.05"
              min="1"
              max="3"
              value={config.break.high}
              onChange={(e) =>
                setConfig({
                  ...config,
                  break: { ...config.break, high: safeParseFloat(e.target.value, config.break.high) },
                })
              }
              className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
            />
            <span className="text-gray-500 text-xs">({Math.round(config.break.high * 100)}%)</span>
          </div>
        </div>
      </div>

      {/* Trim */}
      <div className="flex items-center gap-2 mb-3">
        <label className="text-gray-500 text-xs">Trim (sec):</label>
        <input
          type="number"
          step="1"
          min="0"
          max="60"
          value={config.trim_seconds}
          onChange={(e) =>
            setConfig({ ...config, trim_seconds: safeParseFloat(e.target.value, config.trim_seconds) })
          }
          className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
        />
        <span className="text-gray-500 text-xs">skip first/last N sec</span>
      </div>

      {/* Confirm */}
      <div className="flex items-center gap-2 mb-4">
        <label className="text-gray-500 text-xs">Confirm:</label>
        <input
          type="number"
          step="1"
          min="0"
          max="8"
          value={config.confirm_beats}
          onChange={(e) =>
            setConfig({ ...config, confirm_beats: Math.round(safeParseFloat(e.target.value, config.confirm_beats)) })
          }
          className="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
        />
        <span className="text-gray-500 text-xs">beats after window (0 = off)</span>
      </div>

      {/* Visual */}
      <div className="text-xs text-gray-500 mb-3 font-mono">
        0%--[{Math.round(config.bridge.low * 100)}%]--BRIDGE--[{Math.round(config.bridge.high * 100)}%]--STABLE--[{Math.round(config.break.low * 100)}%]--BREAK--[{Math.round(config.break.high * 100)}%]--
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded text-xs transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {success && <span className="text-green-400 text-xs">Saved!</span>}
        {error && <span className="text-red-400 text-xs">{error}</span>}
        <span className="text-gray-500 text-xs ml-auto">Re-analyze tracks to apply</span>
      </div>
    </div>
  );
}
