import type { VRM, VRMHumanoid } from '@pixiv/three-vrm'
import { Object3D, Quaternion, Vector3 } from 'three'
import { applyArmIKFromTransform, applyHandRotationFromTransform } from '../armIK'
import type { ControllerTransform } from '../types'
import { GRIP_PALM_RATIO } from '../vrIK'

const KNUCKLE = new Vector3(0.08, 0, 0)

/**
 * 左腕だけの VRM 1.0 を作る（アバターは +Z を向くので左腕は +X へ伸びる）
 * 肩 (0.2, 1.4, 0) → 肘 → 手首 → 中指の付け根
 */
function createLeftArmVRM(): { vrm: VRM; hand: Object3D } {
  const scene = new Object3D()
  const upperArm = new Object3D()
  upperArm.position.set(0.2, 1.4, 0)
  const lowerArm = new Object3D()
  lowerArm.position.set(0.25, 0, 0)
  const hand = new Object3D()
  hand.position.set(0.25, 0, 0)
  const middleProximal = new Object3D()
  middleProximal.position.copy(KNUCKLE)
  scene.add(upperArm)
  upperArm.add(lowerArm)
  lowerArm.add(hand)
  hand.add(middleProximal)
  scene.updateMatrixWorld(true)

  const bones: Record<string, Object3D> = {
    leftUpperArm: upperArm,
    leftLowerArm: lowerArm,
    leftHand: hand,
    leftMiddleProximal: middleProximal,
  }
  const humanoid = {
    getNormalizedBoneNode: (name: string) => bones[name] ?? null,
  } as unknown as VRMHumanoid
  return { vrm: { scene, humanoid } as unknown as VRM, hand }
}

function createTransform(isHandTracking: boolean): ControllerTransform {
  return {
    position: new Vector3(0.45, 1.2, 0.25),
    rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.4),
    isHandTracking,
  }
}

function solve(vrm: VRM, transform: ControllerTransform, fromGrip: boolean) {
  applyArmIKFromTransform(vrm, transform, null, new Quaternion(), { fromGrip })
  applyHandRotationFromTransform(vrm, transform, null)
}

describe('applyArmIKFromTransform', () => {
  it('fromGrip なしなら手首がコントローラーの位置に来る', () => {
    const { vrm, hand } = createLeftArmVRM()
    const transform = createTransform(false)

    solve(vrm, transform, false)

    const wrist = hand.getWorldPosition(new Vector3())
    expect(wrist.distanceTo(transform.position)).toBeLessThan(0.001)
  })

  it('fromGrip なら握りの中心（手首と中指の付け根の間）がコントローラーの位置に来る', () => {
    const { vrm, hand } = createLeftArmVRM()
    const transform = createTransform(false)

    solve(vrm, transform, true)

    const grip = KNUCKLE.clone().multiplyScalar(GRIP_PALM_RATIO)
    hand.localToWorld(grip)
    expect(grip.distanceTo(transform.position)).toBeLessThan(0.001)
    // 手首はコントローラーより後ろに下がっている
    const wrist = hand.getWorldPosition(new Vector3())
    expect(wrist.distanceTo(transform.position)).toBeCloseTo(KNUCKLE.x * GRIP_PALM_RATIO)
  })

  it('ハンドトラッキングは wrist の関節そのものなので fromGrip でも戻さない', () => {
    const { vrm, hand } = createLeftArmVRM()
    const transform = createTransform(true)

    solve(vrm, transform, true)

    const wrist = hand.getWorldPosition(new Vector3())
    expect(wrist.distanceTo(transform.position)).toBeLessThan(0.001)
  })

  it('XROrigin のスケールと位置を掛けてから合わせる', () => {
    const { vrm, hand } = createLeftArmVRM()
    const transform = createTransform(false)
    transform.position.set(0.2, 0.6, 0.1)

    applyArmIKFromTransform(vrm, transform, null, new Quaternion(), {
      xrOriginWorldPos: new Vector3(0.05, 0, 0.05),
      xrOriginWorldQuat: new Quaternion(),
      xrOriginScale: 2,
    })

    const wrist = hand.getWorldPosition(new Vector3())
    expect(wrist.distanceTo(new Vector3(0.45, 1.2, 0.25))).toBeLessThan(0.001)
  })
})
