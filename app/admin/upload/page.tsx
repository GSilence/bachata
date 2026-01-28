"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const CONCURRENCY = 2;

interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  track?: string;
  comment?: string;
}

type ItemStatus = "pending" | "processing" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  metadata: TrackMetadata;
  status: ItemStatus;
  error?: string;
}

async function extractMetadataFromFile(file: File): Promise<TrackMetadata> {
  try {
    const jsmediatags = await import("jsmediatags");
    return new Promise<TrackMetadata>((resolve) => {
      jsmediatags.default.read(file, {
        onSuccess: (tag: { tags?: Record<string, unknown> }) => {
          const extracted: TrackMetadata = {};
          const tags = tag.tags || {};
          if (tags.title) extracted.title = String(tags.title);
          if (tags.artist) extracted.artist = String(tags.artist);
          if (tags.album) extracted.album = String(tags.album);
          if (tags.genre)
            extracted.genre =
              typeof tags.genre === "string"
                ? tags.genre
                : String(tags.genre ?? "");
          if (tags.year) extracted.year = String(tags.year ?? "");
          if (tags.track) extracted.track = String(tags.track ?? "");
          if (tags.comment != null) {
            const c = tags.comment as { text?: string } | string;
            extracted.comment = typeof c === "string" ? c : (c?.text ?? "");
          }
          if (!extracted.title) {
            extracted.title = file.name.replace(/\.mp3$/i, "");
          }
          resolve(extracted);
        },
        onError: () => {
          resolve({ title: file.name.replace(/\.mp3$/i, "") });
        },
      });
    });
  } catch {
    return { title: file.name.replace(/\.mp3$/i, "") };
  }
}

type AnalyzerChoice = "basic" | "extended";

export default function AdminUploadPage() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [uploadAnalyzer, setUploadAnalyzer] =
    useState<AnalyzerChoice>("extended");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;

  const updateItem = (
    id: string,
    patch: Partial<Pick<QueueItem, "status" | "error" | "metadata">>,
  ) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected?.length) return;
    const files = Array.from(selected);
    setIsExtracting(true);
    setGlobalError(null);
    setAllDone(false);
    try {
      const meta = await Promise.all(files.map(extractMetadataFromFile));
      const newItems: QueueItem[] = files.map((file, i) => ({
        id: `${file.name}-${file.size}-${i}-${Date.now()}`,
        file,
        metadata: meta[i] ?? { title: file.name.replace(/\.mp3$/i, "") },
        status: "pending",
      }));
      setItems(newItems);
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error ? err.message : "Ошибка подготовки файлов",
      );
    } finally {
      setIsExtracting(false);
    }
    e.target.value = "";
  };

  const processOne = async (
    item: QueueItem,
  ): Promise<{ id: string; status: "done" | "error"; error?: string }> => {
    const m = item.metadata;
    if (!m.title?.trim()) {
      return {
        id: item.id,
        status: "error",
        error: "Название трека обязательно",
      };
    }
    const formData = new FormData();
    formData.append("file", item.file);
    formData.append("title", m.title);
    if (m.artist) formData.append("artist", m.artist);
    if (m.album) formData.append("album", m.album);
    if (m.genre) formData.append("genre", m.genre);
    if (m.year) formData.append("year", m.year);
    if (m.track) formData.append("track", m.track);
    if (m.comment) formData.append("comment", m.comment);
    formData.append("autoBpm", "true");
    formData.append("autoOffset", "true");
    formData.append("analyzer", uploadAnalyzer);

    try {
      const res = await fetch("/api/process-track", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok)
        return {
          id: item.id,
          status: "error",
          error: data.error || "Ошибка обработки",
        };
      return { id: item.id, status: "done" };
    } catch (err: unknown) {
      return {
        id: item.id,
        status: "error",
        error: err instanceof Error ? err.message : "Ошибка сети",
      };
    }
  };

  const runQueue = async () => {
    const bad = itemsRef.current.filter(
      (i) => i.status === "pending" && !i.metadata.title?.trim(),
    );
    if (bad.length) {
      setGlobalError("У всех треков должно быть указано название");
      return;
    }
    setGlobalError(null);
    setAllDone(false);
    setIsProcessing(true);

    while (true) {
      const current = itemsRef.current;
      const pending = current.filter((i) => i.status === "pending");
      if (pending.length === 0) break;
      const batch = pending.slice(0, CONCURRENCY);
      setItems((prev) =>
        prev.map((it) =>
          batch.some((b) => b.id === it.id)
            ? { ...it, status: "processing" as const }
            : it,
        ),
      );
      const results = await Promise.all(batch.map(processOne));
      setItems((prev) =>
        prev.map((it) => {
          const r = results.find((x) => x.id === it.id);
          if (!r) return it;
          return { ...it, status: r.status, error: r.error };
        }),
      );
    }
    setIsProcessing(false);
    setAllDone(true);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const total = items.length;
  const progressLabel =
    total > 0
      ? isProcessing
        ? `Обработано ${doneCount + errorCount} из ${total}`
        : allDone
          ? `Готово: ${doneCount} успешно, ${errorCount} с ошибками`
          : `${total} файл(ов) в очереди`
      : null;

  return (
    <div className="min-h-screen p-8 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-gray-800">
          Загрузка и обработка треков
        </h1>

        <div className="bg-white rounded-lg shadow-md p-6">
          {globalError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {globalError}
            </div>
          )}

          {allDone && doneCount > 0 && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex items-center justify-between flex-wrap gap-2">
              <span>
                Загрузка завершена. Успешно: {doneCount}
                {errorCount > 0 ? `, с ошибками: ${errorCount}` : ""}.
              </span>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Перейти в библиотеку
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Анализатор ритма (общий для всех файлов)
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="uploadAnalyzer"
                    checked={uploadAnalyzer === "extended"}
                    onChange={() => setUploadAnalyzer("extended")}
                    disabled={isProcessing}
                    className="text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">
                    Расширенный анализ
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="uploadAnalyzer"
                    checked={uploadAnalyzer === "basic"}
                    onChange={() => setUploadAnalyzer("basic")}
                    disabled={isProcessing}
                    className="text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Базовый анализ</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                MP3 файлы (можно несколько)
              </label>
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,.mp3"
                multiple
                onChange={handleFileChange}
                disabled={isExtracting || isProcessing}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-primary file:text-white
                  hover:file:bg-primary-dark
                  file:cursor-pointer
                  disabled:opacity-50"
              />
              {isExtracting && (
                <p className="mt-2 text-sm text-blue-600">
                  Извлечение метаданных…
                </p>
              )}
            </div>

            {progressLabel && (
              <p className="text-sm font-medium text-gray-700">
                {progressLabel}
              </p>
            )}

            {items.length > 0 && (
              <ul className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="border border-gray-200 rounded-lg p-3 bg-gray-50/60 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span
                        className="text-sm text-gray-600 truncate flex-1 min-w-0"
                        title={it.file.name}
                      >
                        {it.file.name}
                      </span>
                      <span className="text-xs shrink-0 text-gray-500">
                        {(it.file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      {it.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          disabled={isProcessing}
                          className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
                        >
                          Удалить
                        </button>
                      )}
                      <StatusBadge status={it.status} error={it.error} />
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <div>
                        <label className="sr-only">Название</label>
                        <input
                          type="text"
                          value={it.metadata.title ?? ""}
                          onChange={(e) =>
                            updateItem(it.id, {
                              metadata: {
                                ...it.metadata,
                                title: e.target.value,
                              },
                            })
                          }
                          disabled={it.status !== "pending"}
                          placeholder="Название *"
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary text-black disabled:opacity-60"
                        />
                      </div>
                      <div>
                        <label className="sr-only">Исполнитель</label>
                        <input
                          type="text"
                          value={it.metadata.artist ?? ""}
                          onChange={(e) =>
                            updateItem(it.id, {
                              metadata: {
                                ...it.metadata,
                                artist: e.target.value,
                              },
                            })
                          }
                          disabled={it.status !== "pending"}
                          placeholder="Исполнитель"
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary text-black disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {items.length > 0 && (
              <button
                type="button"
                onClick={runQueue}
                disabled={
                  isProcessing ||
                  isExtracting ||
                  items.every((i) => i.status !== "pending")
                }
                className="w-full py-3 px-4 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Обработка… (по {CONCURRENCY} файла, может занять несколько
                    минут)
                  </span>
                ) : (
                  "Загрузить и обработать всё"
                )}
              </button>
            )}
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Требования:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>
                • На сервере должны быть Python 3.8+, FFmpeg и{" "}
                <code className="bg-blue-100 px-1 rounded">
                  pip install madmom librosa soundfile
                </code>
              </li>
              <li>
                • Обработка идёт по {CONCURRENCY} файла одновременно, затем
                следующие
              </li>
              <li>• Максимум 100 MB на файл</li>
            </ul>
            <p className="text-xs text-blue-700 mt-2">
              💡 BPM и Offset определяются автоматически. Стемы (Demucs) — по
              запросу из плейлиста, по одному треку.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: ItemStatus;
  error?: string;
}) {
  const wrap = (label: string, className: string) => (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
  if (status === "pending")
    return wrap("Ожидание", "bg-gray-200 text-gray-700");
  if (status === "processing")
    return wrap("Обработка…", "bg-amber-100 text-amber-800");
  if (status === "done") return wrap("Готово", "bg-green-100 text-green-800");
  return wrap(error ?? "Ошибка", "bg-red-100 text-red-800");
}
