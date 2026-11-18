import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { type Object3D, Quaternion, Vector3 } from 'three'
import type { FingerCurlData } from './types'

/**
 * 握りきったときの関節ごとの曲げ角（ラジアン）。
 * 正規化ボーンは T ポーズ・手のひら下向きなので、4本指は Z 軸回り、親指は X 軸回りに曲げる
 */
const FINGER_JOINT_ANGLES = {
  Proximal: (70 * Math.PI) / 180,
  Intermediate: (90 * Math.PI) / 180,
  Distal: (60 * Math.PI) / 180,
} as const

const THUMB_JOINT_ANGLES = {
  Metacarpal: (20 * Math.PI) / 180,
  Proximal: (35 * Math.PI) / 180,
  Distal: (45 * Math.PI) / 180,
} as const

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

interface FingerJoint {
  bone: VRMHumanBoneName
  axis: Vector3
  /** 握りきったときの角度（左右の符号込み） */
  angle: number
}

/**
 * 片手ぶんの関節と曲げ方を返す。
 * 4本指は左手が -Z、右手が +Z 回りで手のひら側へ曲がる（左右対称なので符号が逆）。
 * 親指は X 軸回りで、左右とも同じ符号で手のひら側へ寄る
 */
export function getFingerJoints(side: 'left' | 'right'): FingerJoint[] {
  const sign = side === 'left' ? -1 : 1
  const joints: FingerJoint[] = []
  for (const finger of FINGERS) {
    for (const [joint, angle] of Object.entries(FINGER_JOINT_ANGLES)) {
      joints.push({
        bone: `${side}${finger}${joint}` as VRMHumanBoneName,
        axis: AXIS_Z,
        angle: sign * angle,
      })
    }
  }
  for (const [joint, angle] of Object.entries(THUMB_JOINT_ANGLES)) {
    joints.push({ bone: `${side}Thumb${joint}` as VRMHumanBoneName, axis: AXIS_X, angle })
  }
  return joints
}

const LEFT_JOINTS = getFingerJoints('left')
const RIGHT_JOINTS = getFingerJoints('right')

/** 指の曲がり（0〜1）を範囲に収める。壊れた値（NaN 等）は開いた手にする */
export function clampFingerCurl(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * ボーンごとに「曲げる前の姿勢」と「曲げた結果」を覚えておく。
 * アニメーションが指を書かない VRM では前フレームの結果がそのまま残るので、
 * 掛け足すと曲がりが溜まり続ける。結果のままなら前の「曲げる前」を使い、
 * アニメーションが書き換えていればそれを新しい「曲げる前」にする
 */
export interface BoneCurlState {
  base: Quaternion
  result: Quaternion
}

const _curl = new Quaternion()

/**
 * 1本の関節に曲がりを当てる（テストのため Object3D を直接受け取る）
 * @param states ボーンごとの状態（呼び出し側がアバターごとに持つ）
 */
export function applyJointCurl(
  bone: Object3D,
  axis: Vector3,
  angle: number,
  curl: number,
  states: WeakMap<Object3D, BoneCurlState>,
): void {
  let state = states.get(bone)
  if (!state) {
    state = { base: bone.quaternion.clone(), result: bone.quaternion.clone() }
    states.set(bone, state)
  } else if (!bone.quaternion.equals(state.result)) {
    state.base.copy(bone.quaternion)
  }

  _curl.setFromAxisAngle(axis, angle * curl)
  bone.quaternion.copy(state.base).multiply(_curl)
  state.result.copy(bone.quaternion)
}

/** アバターごとの指の状態を作る（レンダラーで1つ持つ） */
export function createFingerCurlStates(): WeakMap<Object3D, BoneCurlState> {
  return new WeakMap()
}

/**
 * 指の曲がりをアバターに当てる。アニメーションの更新の後、vrm.update の前に呼ぶ
 * @param curl 左右の曲がり（0=開く、1=握る）
 */
export function applyFingerCurl(
  vrm: VRM,
  curl: FingerCurlData,
  states: WeakMap<Object3D, BoneCurlState>,
): void {
  const humanoid = vrm.humanoid
  if (!humanoid) return
  const sides = [
    [LEFT_JOINTS, clampFingerCurl(curl.left)],
    [RIGHT_JOINTS, clampFingerCurl(curl.right)],
  ] as const
  for (const [joints, value] of sides) {
    for (const joint of joints) {
      const bone = humanoid.getNormalizedBoneNode(joint.bone)
      if (!bone) continue
      applyJointCurl(bone, joint.axis, joint.angle, value, states)
    }
  }
}
