import type { ChangeEvent } from 'react'
import { mutedStyle, sectionStyle } from './styles'

type Props = {
  label: string
  /** 今の値（unit の単位） */
  value: number
  min: number
  max: number
  /** onChange で e.target.name から、どの値を変えたか分かるようにする */
  name?: string
  /** 値の横に出す単位（省略すると °） */
  unit?: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}

/** 値を 1 刻みで動かすスライダー（ラベルの横に今の値と単位を出す。既定は度） */
export function DegreeSlider({ label, value, min, max, name, unit = '°', onChange }: Props) {
  return (
    <label style={sectionStyle}>
      <span>
        {label} <span style={mutedStyle}>{`${value}${unit}`}</span>
      </span>
      <input
        type="range"
        name={name}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
      />
    </label>
  )
}
