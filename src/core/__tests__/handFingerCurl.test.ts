import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { getFingerCurl } from '../fingerCurl'
import { computeFingerCurls, measureFingerBend, measureThumbSwing } from '../handFingerCurl'

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

describe('measureThumbSwing', () => {
  // 右手を、手のひらを下（-Y）・指先を前（-Z）に置く。親指の側は -X
  const base = (thumbTip: Vector3) =>
    new Map<string, Vector3>([
      ['wrist', new Vector3(0, 0, 0)],
      ['middle-finger-phalanx-proximal', new Vector3(0, 0, -0.1)],
      ['index-finger-phalanx-proximal', new Vector3(-0.025, 0, -0.1)],
      ['pinky-finger-phalanx-proximal', new Vector3(0.035, 0, -0.08)],
      ['thumb-metacarpal', new Vector3(-0.02, 0, -0.03)],
      ['thumb-tip', thumbTip],
    ])

  it('親指を横に開くと 0° 近く、手のひらの前（下）へ寄せると 90° 近く', () => {
    const out = base(new Vector3(-0.08, 0, -0.03))
    const under = base(new Vector3(-0.02, -0.06, -0.03))
    expect(measureThumbSwing((j) => out.get(j), 'right')).toBeCloseTo(0)
    expect(measureThumbSwing((j) => under.get(j), 'right')).toBeCloseTo(90)
  })

  it('親指を立てる（手の甲の側）と負になる', () => {
    const up = base(new Vector3(-0.05, 0.05, -0.03))
    expect(measureThumbSwing((j) => up.get(j), 'right')).toBeLessThan(0)
  })

  it('左手は鏡像（X を反転）でも同じ角度', () => {
    const mirror = (map: Map<string, Vector3>) =>
      new Map([...map].map(([k, v]) => [k, new Vector3(-v.x, v.y, v.z)]))
    const under = mirror(base(new Vector3(-0.02, -0.06, -0.03)))
    expect(measureThumbSwing((j) => under.get(j), 'left')).toBeCloseTo(90)
  })

  it('左右を渡すと、親指は回り込みも見て大きいほうを使う', () => {
    const under = base(new Vector3(-0.02, -0.06, -0.03))
    const withSide = computeFingerCurls((j) => under.get(j), undefined, 'right')
    const withoutSide = computeFingerCurls((j) => under.get(j))
    expect(withSide.thumb).toBe(1)
    expect(withoutSide.thumb).toBe(0)
  })
})
