import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { type Object3D, Quaternion, Vector3 } from 'three'
import type { FingerCurlData, FingerName } from './types.js'

/**
 * 握りきったときの関節ごとの曲げ角（ラジアン）。
 * 正規化ボーンは T ポーズ・手のひら下向きなので、4本指は Z 軸回り、親指は X 軸回りに曲げる
 * （親指の付け根だけは、手のひらの前へ回り込む向きに回す。getThumbOpposition）
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

const FINGERS = [
  ['Index', 'index'],
  ['Middle', 'middle'],
  ['Ring', 'ring'],
  ['Little', 'little'],
] as const

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

/**
 * 握りこぶしで親指（付け根から先）が向く方向（手のボーンのローカル。右手）。
 * VRM 1.0 の正規化した右手は、指先が -X・手のひらが -Y・親指の側が +Z。
 * Android XR・Quest 3 の握りこぶしの実機のログ（手のひらの前へ回り込み、指先の方へ伸びる）から。
 * 左手は X を反転する
 */
const OPPOSED_THUMB_DIRECTION_RIGHT = new Vector3(-0.82, -0.52, 0.24).normalize()
const OPPOSED_THUMB_DIRECTION_LEFT = new Vector3(0.82, -0.52, 0.24).normalize()

/** 親指の付け根を回す軸と、握りきったときの角度（アバターの親指の向きから求める） */
interface ThumbOpposition {
  axis: Vector3
  angle: number
}

const _thumbRest = new Vector3()

/**
 * 親指の付け根を、アバターの親指の向き（付け根→次の関節）から、握りこぶしの親指の向きへ回す
 * 軸と角度を求める。アバターごとに親指の向きが違うので、正規化ボーンの位置から毎回決める
 * @param nextJointPosition 親指の次の関節（Proximal）の、付け根から見た位置
 */
export function getThumbOpposition(
  side: 'left' | 'right',
  nextJointPosition: Vector3,
): ThumbOpposition | null {
  _thumbRest.copy(nextJointPosition)
  if (_thumbRest.lengthSq() < 1e-12) return null
  _thumbRest.normalize()
  const target = side === 'left' ? OPPOSED_THUMB_DIRECTION_LEFT : OPPOSED_THUMB_DIRECTION_RIGHT
  const axis = new Vector3().crossVectors(_thumbRest, target)
  if (axis.lengthSq() < 1e-12) return null
  return { axis: axis.normalize(), angle: _thumbRest.angleTo(target) }
}

interface FingerJoint {
  bone: VRMHumanBoneName
  /** どの指の関節か（指ごとの曲がりを引く） */
  finger: FingerName
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
  for (const [boneName, finger] of FINGERS) {
    for (const [joint, angle] of Object.entries(FINGER_JOINT_ANGLES)) {
      joints.push({
        bone: `${side}${boneName}${joint}` as VRMHumanBoneName,
        finger,
        axis: AXIS_Z,
        angle: sign * angle,
      })
    }
  }
  for (const [joint, angle] of Object.entries(THUMB_JOINT_ANGLES)) {
    joints.push({
      bone: `${side}Thumb${joint}` as VRMHumanBoneName,
      finger: 'thumb',
      axis: AXIS_X,
      angle,
    })
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

/** その指の曲がり（指ごとの値があればそれ、無ければ手の値） */
export function getFingerCurl(
  curl: FingerCurlData,
  side: 'left' | 'right',
  finger: FingerName,
): number {
  return clampFingerCurl(curl.fingers?.[side]?.[finger] ?? curl[side])
}

/**
 * 指の曲がりをアバターに当てる。アニメーションの更新の後、vrm.update の前に呼ぶ
 * @param curl 左右の曲がり（0=開く、1=握る）。指ごとの値（fingers）があればそれを使う
 */
export function applyFingerCurl(
  vrm: VRM,
  curl: FingerCurlData,
  states: WeakMap<Object3D, BoneCurlState>,
): void {
  const humanoid = vrm.humanoid
  if (!humanoid) return
  const sides = [
    ['left', LEFT_JOINTS],
    ['right', RIGHT_JOINTS],
  ] as const
  for (const [side, joints] of sides) {
    for (const joint of joints) {
      const bone = humanoid.getNormalizedBoneNode(joint.bone)
      if (!bone) continue
      const value = getFingerCurl(curl, side, joint.finger)
      // 親指の付け根は、手のひらの前へ回り込む向きに回す（指の軸回りに倒すだけでは回り込まない）。
      // 指ごとの値（ハンドトラッキング）があるときだけ。コントローラーのグリップでは今までどおり
      // （持った物やコントローラーに親指がめり込まないように）
      const opposition =
        joint.bone === `${side}ThumbMetacarpal` && curl.fingers?.[side]
          ? getCachedThumbOpposition(humanoid, side)
          : null
      if (opposition) {
        applyJointCurl(bone, opposition.axis, opposition.angle, value, states)
        continue
      }
      applyJointCurl(bone, joint.axis, joint.angle, value, states)
    }
  }
}

const _thumbOppositions = new WeakMap<
  object,
  Partial<Record<'left' | 'right', ThumbOpposition | null>>
>()

/** アバターごと・左右ごとに、親指の付け根を回す軸と角度を一度だけ求めて覚えておく */
function getCachedThumbOpposition(
  humanoid: NonNullable<VRM['humanoid']>,
  side: 'left' | 'right',
): ThumbOpposition | null {
  let cache = _thumbOppositions.get(humanoid)
  if (!cache) {
    cache = {}
    _thumbOppositions.set(humanoid, cache)
  }
  if (cache[side] === undefined) {
    const next = humanoid.getNormalizedBoneNode(`${side}ThumbProximal`)
    cache[side] = next ? getThumbOpposition(side, next.position) : null
  }
  return cache[side] ?? null
}
