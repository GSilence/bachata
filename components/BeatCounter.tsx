"use client";

interface BeatCounterProps {
  currentBeat: number; // 0-7 (соответствует 1-8)
  hasStarted: boolean; // true если первый бит уже начался
}

export default function BeatCounter({
  currentBeat,
  hasStarted,
}: BeatCounterProps) {
  const beats = [1, 2, 3, 4, 5, 6, 7, 8];

  // Если счет еще не начался, показываем все биты неактивными
  if (!hasStarted) {
    return (
      <div
        className="flex justify-center items-center gap-4 md:gap-8"
        data-component="beat-counter"
      >
        {beats.map((beat) => (
          <div
            key={beat}
            data-beat={beat}
            data-active={false}
            className="scale-100 text-gray-600 text-2xl md:text-5xl"
          >
            {beat}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex justify-center items-center gap-4 md:gap-8"
      data-component="beat-counter"
    >
      {beats.map((beat, index) => {
        const isActive = index === currentBeat;
        return (
          <div
            key={beat}
            data-beat={beat}
            data-active={isActive}
            className={`
              transition-all duration-200
              ${
                isActive
                  ? "scale-[1.7] font-bold text-purple-400"
                  : "scale-100 text-gray-400"
              }
              text-2xl md:text-5xl
            `}
          >
            {beat}
          </div>
        );
      })}
    </div>
  );
}
