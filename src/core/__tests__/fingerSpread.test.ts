import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { computeFingerSpread, getSpreadRotation } from '../fingerSpread'

/**
 * 右手を、手のひらを下（-Y）・指先を前（-Z）に置く。親指の側は -X。
 * 各指の根元の骨を、指先の向きから親指の側へ spreadDeg 傾ける（中指は傾けない）
 */
function hand(spread: { index: number; ring: number; little: number }, bend = 0) {
  const positions = new Map<string, Vector3>()
  positions.set('wrist', new Vector3(0, 0, 0))
  const fingers = [
    ['index', -0.025, spread.index],
    ['middle', 0, 0],
    ['ring', 0.02, spread.ring],
    ['pinky', 0.035, spread.little],
  ] as const
  for (const [name, x, deg] of fingers) {
    const base = new Vector3(x, 0, -0.09)
    const rad = (deg * Math.PI) / 180
    // 親指の側（-X）へ傾け、bend だけ手のひらの側（-Y）へ曲げる
    const dir = new Vector3(-Math.sin(rad), 0, -Math.cos(rad))
      .multiplyScalar(Math.cos(bend))
      .add(new Vector3(0, -Math.sin(bend), 0))
    positions.set(`${name}-finger-phalanx-proximal`, base)
    positions.set(`${name}-finger-phalanx-intermediate`, base.clone().addScaledVector(dir, 0.04))
  }
  return (joint: string) => positions.get(joint)
}

describe('computeFingerSpread', () => {
  it('中指から見た根元の骨の向きを、親指の側を + にした度で返す', () => {
    const spread = computeFingerSpread(hand({ index: 10, ring: -5, little: -15 }))
    expect(spread?.index).toBeCloseTo(10)
    expect(spread?.ring).toBeCloseTo(-5)
    expect(spread?.little).toBeCloseTo(-15)
  })

  it('指をそろえた手は 0', () => {
    const spread = computeFingerSpread(hand({ index: 0, ring: 0, little: 0 }))
    expect(spread).toEqual({ index: 0, ring: 0, little: 0 })
  })

  it('人の指が開ける範囲で止める', () => {
    const spread = computeFingerSpread(hand({ index: 80, ring: -80, little: -80 }))
    expect(spread?.index).toBe(30)
    expect(spread?.ring).toBe(-25)
    expect(spread?.little).toBe(-40)
  })

  it('曲げて手のひらの側を向いた指は測らない（0）', () => {
    const bent = (80 * Math.PI) / 180
    const spread = computeFingerSpread(hand({ index: 10, ring: -5, little: -15 }, bent))
    expect(spread).toEqual({ index: 0, ring: 0, little: 0 })
  })

  it('手のひらが決まらなければ null', () => {
    expect(computeFingerSpread(() => undefined)).toBeNull()
  })
})

describe('getSpreadRotation', () => {
  // VRM 1.0 の正規化した手: 右手は指先 -X、左手は +X、どちらも親指の側は +Z
  const tip = (side: 'left' | 'right', degrees: number, curl = 0) =>
    new Vector3(side === 'right' ? -1 : 1, 0, 0).applyQuaternion(
      getSpreadRotation(side, degrees, curl, new Quaternion()),
    )

  it('+ の開きで、指先が親指の側（+Z）へ向く（左右とも）', () => {
    expect(tip('right', 20).z).toBeGreaterThan(0.3)
    expect(tip('left', 20).z).toBeGreaterThan(0.3)
  })

  it('握った指ほど弱める（握りきると開かない）', () => {
    expect(tip('right', 20, 1).z).toBeCloseTo(0)
    expect(tip('right', 20, 0.5).z).toBeLessThan(tip('right', 20).z)
  })
})
