import type { ChangeEvent } from 'react'
import type { BodyMetrics, SpineBends } from './bodyMetrics'
import { DegreeSlider } from './DegreeSlider'
import { mutedStyle, sectionStyle } from './styles'
import { TorsoBendControls } from './TorsoBendControls'
import type { TorsoBendDegrees } from './torsoBend'

type Props = {
  /** 下を向く角度（度、下向きが正） */
  pitchDegrees: number
  /** 首を軸に頭も動かす */
  pivotOnNeck: boolean
  onPitchChange: (e: ChangeEvent<HTMLInputElement>) => void
  onPivotOnNeckChange: (e: ChangeEvent<HTMLInputElement>) => void
  /** アバターから測った値（まだ無ければ null） */
  metrics: BodyMetrics | null
  /** 背中を曲げる量（スライダー用の度・cm・%） */
  torsoBendDegrees: TorsoBendDegrees
  onTorsoBendChange: (e: ChangeEvent<HTMLInputElement>) => void
  onTorsoBendReset: () => void
}

export const HEAD_PITCH_MIN = -60
export const HEAD_PITCH_MAX = 90

const toDegrees = (rad: number) => Math.round((rad * 180) / Math.PI)
/** 骨が無いときは「無し」 */
const formatBend = (rad: number | null) => (rad === null ? '無し' : `${toDegrees(rad)}°`)

/** 背骨と首の傾きの 1 行 */
function formatBends(bends: SpineBends): string {
  return [
    `spine ${formatBend(bends.spine)}`,
    `chest ${formatBend(bends.chest)}`,
    `upperChest ${formatBend(bends.upperChest)}`,
    `neck ${formatBend(bends.neck)}`,
  ].join('・')
}

/** アバターに upperChest・neck があるか（無いとそのスライダーが効かない理由） */
function formatBoneAvailability(bends: SpineBends): string {
  const upperChest = bends.upperChest === null ? '無し（chest に足す）' : 'あり'
  const neck = bends.neck === null ? '無し（頭が受け持つ）' : 'あり'
  return `このアバター: upperChest ${upperChest}・neck ${neck}`
}
/** cm で小数 1 桁。0 に丸まるときは「-0.0」と出さない */
function toCentimeters(m: number): string {
  const cm = (m * 100).toFixed(1)
  return Number(cm) === 0 ? '0.0' : cm
}

/** 見本のポーズの頭の向き（VR で下を向いたときの背中の曲げと腰の動きを、VR に入らずに見る） */
export function HeadControls({
  pitchDegrees,
  pivotOnNeck,
  onPitchChange,
  onPivotOnNeckChange,
  metrics,
  torsoBendDegrees,
  onTorsoBendChange,
  onTorsoBendReset,
}: Props) {
  return (
    <div style={sectionStyle}>
      <strong>頭の向き</strong>
      <DegreeSlider
        label="下を向く角度"
        value={pitchDegrees}
        min={HEAD_PITCH_MIN}
        max={HEAD_PITCH_MAX}
        onChange={onPitchChange}
      />
      <label>
        <input type="checkbox" checked={pivotOnNeck} onChange={onPivotOnNeckChange} />{' '}
        首を軸に頭も動かす（実際の人の動き）
      </label>
      <div style={mutedStyle}>背中の曲げ: {metrics ? formatBends(metrics.bends) : '—'}</div>
      {metrics && <div style={mutedStyle}>{formatBoneAvailability(metrics.bends)}</div>}
      <div style={mutedStyle}>
        腰の後ろへの移動: {metrics ? `${toCentimeters(metrics.hipsBack)}cm` : '—'}
      </div>
      <div style={mutedStyle}>
        腰が下がった量: {metrics ? `${toCentimeters(metrics.hipsDrop)}cm` : '—'}
      </div>
      <div style={mutedStyle}>
        アバターの目とカメラの高さの差: {metrics ? `${toCentimeters(metrics.eyeGap)}cm` : '—'}
      </div>
      <div style={mutedStyle}>
        アバターの目とカメラの前後の差: {metrics ? `${toCentimeters(metrics.eyeBack)}cm` : '—'}
      </div>
      <TorsoBendControls
        degrees={torsoBendDegrees}
        onChange={onTorsoBendChange}
        onReset={onTorsoBendReset}
      />
    </div>
  )
}
