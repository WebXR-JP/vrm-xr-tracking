import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { getFingerCurl } from '../fingerCurl'
import { computeFingerCurls, measureFingerBend } from '../handFingerCurl'

/**
 * 根元から -Z へ伸び、関節ごとに手のひら側（-Y）へ bendDegrees ずつ曲がる指の関節位置を作る
 * @param names 根元から指先への関節名
 */
function bentFinger(names: string[], bendDegrees: number, segment = 0.03) {
  const positions = new Map<string, Vector3>()
  const point = new Vector3(0, 0, 0)
  const direction = new Vector3(0, 0, -1)
  const axis = new Vector3(-1, 0, 0) // -Z を -Y へ倒す回転
  names.forEach((name, i) => {
    positions.set(name, point.clone())
    if (i > 0) direction.applyAxisAngle(axis, (bendDegrees * Math.PI) / 180)
    point.addScaledVector(direction, segment)
  })
  return positions
}

const INDEX = [
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
]
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']

describe('measureFingerBend', () => {
  it('まっすぐな指は 0°', () => {
    const positions = bentFinger(INDEX, 0)
    expect(measureFingerBend('index', (j) => positions.get(j))).toBeCloseTo(0)
  })

  it('関節ごとの曲がりを足す（3 関節 × 40° = 120°）', () => {
    const positions = bentFinger(INDEX, 40)
    expect(measureFingerBend('index', (j) => positions.get(j))).toBeCloseTo(120)
  })

  it('関節が欠けていたら null', () => {
    const positions = bentFinger(INDEX, 40)
    positions.delete('index-finger-tip')
    expect(measureFingerBend('index', (j) => positions.get(j))).toBeNull()
  })

  it('同じ位置の関節が続く（長さ 0 の骨）なら null', () => {
    const positions = bentFinger(INDEX, 40, 0)
    expect(measureFingerBend('index', (j) => positions.get(j))).toBeNull()
  })
})

describe('computeFingerCurls', () => {
  it('開いた手は 0、握りきった手は 1、その間は割合', () => {
    const open = bentFinger(INDEX, 5)
    const half = bentFinger(INDEX, 35)
    const fist = bentFinger(INDEX, 65)
    expect(computeFingerCurls((j) => open.get(j)).index).toBe(0)
    expect(computeFingerCurls((j) => half.get(j)).index).toBeCloseTo(0.5)
    expect(computeFingerCurls((j) => fist.get(j)).index).toBe(1)
  })

  it('親指は動きが小さいので、小さな曲がりで握りきる', () => {
    const thumb = bentFinger(THUMB, 30)
    expect(computeFingerCurls((j) => thumb.get(j)).thumb).toBeCloseTo(1)
  })

  it('関節が取れない指は開いた手（0）にする', () => {
    const curls = computeFingerCurls(() => undefined)
    expect(curls).toEqual({ thumb: 0, index: 0, middle: 0, ring: 0, little: 0 })
  })
})

describe('getFingerCurl', () => {
  it('指ごとの値があればそれ、無ければ手の値', () => {
    const curl = {
      left: 0.2,
      right: 0.8,
      fingers: { right: { thumb: 0, index: 1, middle: 0.5, ring: 0.5, little: 0.5 } },
    }
    expect(getFingerCurl(curl, 'right', 'index')).toBe(1)
    expect(getFingerCurl(curl, 'right', 'thumb')).toBe(0)
    expect(getFingerCurl(curl, 'left', 'index')).toBe(0.2)
  })

  it('壊れた値は開いた手にする', () => {
    const curl = {
      left: 0,
      right: 0,
      fingers: { left: { thumb: Number.NaN, index: 2, middle: -1, ring: 0, little: 0 } },
    }
    expect(getFingerCurl(curl, 'left', 'thumb')).toBe(0)
    expect(getFingerCurl(curl, 'left', 'index')).toBe(1)
    expect(getFingerCurl(curl, 'left', 'middle')).toBe(0)
  })
})
