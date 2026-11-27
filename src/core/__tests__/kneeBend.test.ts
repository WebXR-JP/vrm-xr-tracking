import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Object3D, Vector3 } from 'three'
import { computePosedOffsetFromHips } from '../tracking'
import {
  applyKneeBend,
  computeKneeBendAngles,
  KNEE_BEND_DEADZONE,
  KNEE_BEND_SOFTNESS,
} from '../vrIK'

const LEG_LENGTH = 0.8
const HIPS_HEIGHT = 0.9

/**
 * 太ももとすねが同じ長さ（LEG_LENGTH / 2）の脚を、本物の Object3D の親子で組む
 * hips → upperLeg → lowerLeg → foot（アバターは +Z を向く）
 */
function createLegSkeleton() {
  const bones: Record<string, Object3D> = {}
  const add = (name: string, parent: Object3D | null, position: Vector3): Object3D => {
    const bone = new Object3D()
    bone.position.copy(position)
    parent?.add(bone)
    bones[name] = bone
    return bone
  }
  const hips = add('hips', null, new Vector3(0, HIPS_HEIGHT, 0))
  for (const [side, x] of [
    ['left', 0.08],
    ['right', -0.08],
  ] as const) {
    const upperLeg = add(`${side}UpperLeg`, hips, new Vector3(x, -0.05, 0))
    const lowerLeg = add(`${side}LowerLeg`, upperLeg, new Vector3(0, -LEG_LENGTH / 2, 0))
    add(`${side}Foot`, lowerLeg, new Vector3(0, -LEG_LENGTH / 2, 0))
  }
  const humanoid = {
    getNormalizedBoneNode: (name: string) => bones[name] ?? null,
  } as unknown as VRMHumanoid
  const vrm = { humanoid } as unknown as VRM
  return { vrm, bones }
}

/** 遊びを超えた量 x から、脚を縮める量（computeKneeBendAngles と同じ式） */
function expectedShorten(drop: number): number {
  const x = Math.max(0, drop - KNEE_BEND_DEADZONE)
  return (x * x) / (x + KNEE_BEND_SOFTNESS)
}

/** 足のボーンの位置（hips の親の座標） */
function footPosition(bones: Record<string, Object3D>, side: 'left' | 'right'): Vector3 {
  const out = new Vector3()
  computePosedOffsetFromHips(bones[`${side}Foot`], new Vector3(), bones.hips, out)
  return out.add(bones.hips.position)
}

describe('computeKneeBendAngles', () => {
  it('遊び以下では 0', () => {
    for (const drop of [-0.1, 0, KNEE_BEND_DEADZONE / 2, KNEE_BEND_DEADZONE]) {
      expect(computeKneeBendAngles(drop, LEG_LENGTH)).toEqual({ thigh: 0, knee: 0 })
    }
  })

  it('膝は太ももの 2 倍', () => {
    const { thigh, knee } = computeKneeBendAngles(0.25, LEG_LENGTH)
    expect(thigh).toBeGreaterThan(0)
    expect(knee).toBeCloseTo(thigh * 2)
    expect(thigh).toBeCloseTo(Math.acos(1 - expectedShorten(0.25) / LEG_LENGTH))
  })

  it('遊びのすぐ上では角度が小さい（曲げ始めに段差が無い）', () => {
    const { thigh, knee } = computeKneeBendAngles(KNEE_BEND_DEADZONE + 1e-6, LEG_LENGTH)
    expect(thigh).toBeLessThan(0.01)
    expect(knee).toBeLessThan(0.02)
  })

  it('遊びを 1mm 超えたときの太ももの角度は 1° 未満（曲げ始めがなめらか）', () => {
    const { thigh } = computeKneeBendAngles(KNEE_BEND_DEADZONE + 0.001, LEG_LENGTH)
    expect(thigh).toBeGreaterThan(0)
    expect(thigh).toBeLessThan(Math.PI / 180)
  })

  it('下がった量が増えるほど曲がる', () => {
    let prev = 0
    for (let drop = KNEE_BEND_DEADZONE + 0.01; drop < LEG_LENGTH; drop += 0.05) {
      const { thigh } = computeKneeBendAngles(drop, LEG_LENGTH)
      expect(thigh).toBeGreaterThan(prev)
      prev = thigh
    }
  })

  it('縮める量が脚の長さを超えても NaN にならず、太もも 90°・膝 180° で止まる', () => {
    // 遊びを超えた量が 脚の長さ + 幅 なら、縮める量は脚の長さ以上になる（(L + s)² ≥ L(L + 2s)）
    for (const drop of [
      LEG_LENGTH + KNEE_BEND_DEADZONE + KNEE_BEND_SOFTNESS,
      LEG_LENGTH * 2,
      100,
    ]) {
      const { thigh, knee } = computeKneeBendAngles(drop, LEG_LENGTH)
      expect(thigh).toBeCloseTo(Math.PI / 2)
      expect(knee).toBeCloseTo(Math.PI)
    }
  })

  it('脚の長さが 0 以下でも NaN にならない', () => {
    expect(computeKneeBendAngles(0.3, 0)).toEqual({ thigh: 0, knee: 0 })
    expect(computeKneeBendAngles(0.3, -1)).toEqual({ thigh: 0, knee: 0 })
  })
})

describe('applyKneeBend（足が床に残る）', () => {
  it.each([
    0.05, 0.1, 0.2, 0.4, 0.6,
  ])('腰を %f m 落とすと、脚が縮める量だけ縮み、足は床から遊び＋幅の分までしか下がらない', (drop) => {
    const { vrm, bones } = createLegSkeleton()
    const restFoot = footPosition(bones, 'left')

    bones.hips.position.y = HIPS_HEIGHT - drop
    applyKneeBend(vrm, drop, LEG_LENGTH)

    for (const side of ['left', 'right'] as const) {
      const foot = footPosition(bones, side)
      // 足の高さ: 立ち姿勢から (落とした量 − 縮める量) だけ下がる
      expect(foot.y).toBeCloseTo(restFoot.y - (drop - expectedShorten(drop)), 6)
      // 沈むのは 遊び＋なめらかにする幅 まで
      expect(restFoot.y - foot.y).toBeLessThan(KNEE_BEND_DEADZONE + KNEE_BEND_SOFTNESS)
      // 太ももとすねが同じ長さなので、足は前後にずれない
      expect(foot.z).toBeCloseTo(0, 6)
    }
  })

  it('遊び以下では脚をまっすぐにする', () => {
    const { vrm, bones } = createLegSkeleton()
    bones.leftUpperLeg.rotation.x = -0.5
    bones.leftLowerLeg.rotation.x = 1

    applyKneeBend(vrm, KNEE_BEND_DEADZONE, LEG_LENGTH)

    expect(bones.leftUpperLeg.rotation.x).toBeCloseTo(0)
    expect(bones.leftLowerLeg.rotation.x).toBeCloseTo(0)
  })
})
