import type { VRM } from '@pixiv/three-vrm'
import { Euler, type Object3D, Quaternion, Vector3 } from 'three'
import { getAvatarEyeWorldPosition } from '../src'

/** 背骨と首の前後の傾き（rad、前が正）。骨が無いアバターでは null */
export interface SpineBends {
  spine: number | null
  chest: number | null
  upperChest: number | null
  neck: number | null
}

/** 下を向いたときの体の動き（見本のポーズのときだけ） */
export interface BodyMetrics {
  /** 腰が基本姿勢から後ろへ動いた量（m、ワールドの長さ。アバターの後ろが正） */
  hipsBack: number
  /** 腰が基本姿勢から下がった量（m、ワールドの長さ。下がったとき正） */
  hipsDrop: number
  /** 背骨と首の前後の傾き（ボーンから読んだ値。upperChest が無いと chest に足されている） */
  bends: SpineBends
  /** アバターの目の高さ − カメラ（ユーザーの目）の高さ（m） */
  eyeGap: number
  /** アバターの目がカメラ（ユーザーの目）よりアバターの後ろにある量（m、ワールドの長さ。後ろが正） */
  eyeBack: number
}

const _groupQuat = new Quaternion()
const _leftEye = new Vector3()
const _rightEye = new Vector3()

/**
 * ワールドの差分ベクトルを、group の下の vrm.scene のローカルへ直す
 * （vrm.scene は group に回転・縮尺なしで置いているので、group の回転と縮尺の逆を掛ければよい）
 */
export function worldDeltaToSceneLocal(delta: Vector3, group: Object3D, out: Vector3): Vector3 {
  _groupQuat.copy(group.quaternion).invert()
  return out.copy(delta).applyQuaternion(_groupQuat).divide(group.scale)
}

/** アバターの目のワールド位置。両目があればその中点（腰の位置合わせと同じ基準） */
function avatarEyeWorldPosition(vrm: VRM, out: Vector3): Vector3 {
  const leftEye = vrm.humanoid?.getNormalizedBoneNode('leftEye')
  const rightEye = vrm.humanoid?.getNormalizedBoneNode('rightEye')
  if (leftEye && rightEye) {
    leftEye.getWorldPosition(_leftEye)
    rightEye.getWorldPosition(_rightEye)
    return out.copy(_leftEye).add(_rightEye).multiplyScalar(0.5)
  }
  return out.copy(getAvatarEyeWorldPosition(vrm))
}

const _boneEuler = new Euler()

/** 骨の前後の傾き（YXZ の X。見本のポーズは yaw も roll も 0 なので、そのまま前傾になる） */
function pitchOfBone(vrm: VRM, name: 'spine' | 'chest' | 'upperChest' | 'neck'): number | null {
  const bone = vrm.humanoid?.getNormalizedBoneNode(name)
  if (!bone) return null
  return _boneEuler.setFromQuaternion(bone.quaternion, 'YXZ').x
}

/** 値が変わったかどうかを比べるための文字列（毎フレーム setState しないため） */
export function bodyMetricsKey(metrics: BodyMetrics | null): string {
  if (!metrics) return 'null'
  const { bends } = metrics
  return [
    metrics.hipsBack,
    metrics.hipsDrop,
    metrics.eyeGap,
    metrics.eyeBack,
    bends.spine,
    bends.chest,
    bends.upperChest,
    bends.neck,
  ]
    .map((value) => (value === null ? '-' : value.toFixed(3)))
    .join(',')
}

const _eye = new Vector3()
const _sceneQuat = new Quaternion()
const _forward = new Vector3()

/**
 * 腰の後ろへの移動・下がった量、背骨と首の傾き、アバターの目とカメラの高さ・前後の差を測る（ワールド行列が更新済みであること）
 * VRM 1.0 は +Z が前なので、腰の position の -Z が後ろ。前後の差は vrm.scene の +Z をワールドへ直した向きで測る
 * @param cameraEye カメラ（ユーザーの目）のワールド位置
 */
export function measureBodyMetrics(
  vrm: VRM,
  initialHipsPos: Vector3,
  scale: number,
  cameraEye: Vector3,
): BodyMetrics | null {
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hips) return null
  const eye = avatarEyeWorldPosition(vrm, _eye)
  const forward = _forward.set(0, 0, 1).applyQuaternion(vrm.scene.getWorldQuaternion(_sceneQuat))
  return {
    hipsBack: -(hips.position.z - initialHipsPos.z) * scale,
    hipsDrop: -(hips.position.y - initialHipsPos.y) * scale,
    bends: {
      spine: pitchOfBone(vrm, 'spine'),
      chest: pitchOfBone(vrm, 'chest'),
      upperChest: pitchOfBone(vrm, 'upperChest'),
      neck: pitchOfBone(vrm, 'neck'),
    },
    eyeGap: eye.y - cameraEye.y,
    // カメラから見てアバターの目が後ろ（前の逆）にあるとき正
    eyeBack: -eye.sub(cameraEye).dot(forward),
  }
}
