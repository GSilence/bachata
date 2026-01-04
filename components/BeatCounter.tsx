'use client'

interface BeatCounterProps {
  currentBeat: number // 0-7 (соответствует 1-8)
}

export default function BeatCounter({ currentBeat }: BeatCounterProps) {
  const beats = [1, 2, 3, 4, 5, 6, 7, 8]

  return (
    <div 
      className="flex justify-center items-center gap-4 py-8"
      data-component="beat-counter"
    >
      {beats.map((beat, index) => {
        const isActive = index === currentBeat
        return (
          <div
            key={beat}
            data-beat={beat}
            data-active={isActive}
            className={`
              transition-all duration-200
              ${isActive 
                ? 'scale-125 font-bold text-purple-400' 
                : 'scale-100 text-gray-400'
              }
              text-4xl md:text-5xl
            `}
          >
            {beat}
          </div>
        )
      })}
    </div>
  )
}

