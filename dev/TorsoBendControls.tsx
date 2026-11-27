import type { ChangeEvent } from 'react'
import { DegreeSlider } from './DegreeSlider'
import { mutedStyle, sectionStyle } from './styles'
import { formatTorsoBend, type TorsoBendDegrees, type TorsoBendKey } from './torsoBend'

type Props = {
  degrees: TorsoBendDegrees
  /** スライダーの name（TorsoBendKey）で、どの値を変えたか分かる */
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onReset: () => void
}

/** スライダーごとのラベルと範囲（単位を省くと度） */
const SLIDERS: readonly {
  key: TorsoBendKey
  label: string
  min: number
  max: number
  unit?: string
}[] = [
  { key: 'startPitch', label: '曲げ始める角度', min: 0, max: 60 },
  { key: 'fullPitch', label: '最大になる角度', min: 30, max: 90 },
  { key: 'maxSpine', label: 'spine の最大', min: 0, max: 60 },
  { key: 'maxChest', label: 'chest の最大', min: 0, max: 60 },
  { key: 'maxUpperChest', label: 'upperChest の最大', min: 0, max: 60 },
  { key: 'neckShare', label: '首が受け持つ割合', min: 0, max: 100, unit: '%' },
  { key: 'pullBack', label: '体を後ろへ引く量', min: 0, max: 30, unit: 'cm' },
  { key: 'kneeDrop', label: '屈伸で腰を落とす量', min: 0, max: 20, unit: 'cm' },
]

/** 下を向いたときに背中を曲げる量（DEFAULT_TORSO_BEND を決めるために、見ながら動かす） */
export function TorsoBendControls({ degrees, onChange, onReset }: Props) {
  return (
    <div style={sectionStyle}>
      <strong>背中を曲げる量</strong>
      {SLIDERS.map(({ key, label, min, max, unit }) => (
        <DegreeSlider
          key={key}
          name={key}
          label={label}
          value={degrees[key]}
          min={min}
          max={max}
          unit={unit}
          onChange={onChange}
        />
      ))}
      <code style={{ ...mutedStyle, userSelect: 'all' }}>{formatTorsoBend(degrees)}</code>
      <button type="button" onClick={onReset}>
        既定に戻す
      </button>
    </div>
  )
}
