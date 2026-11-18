import type { VRM } from '@pixiv/three-vrm'
import { createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'
import { AnimationClip, Euler, type Object3D, Quaternion, Vector3 } from 'three'

// 回転分散の比率（Y軸回転のみ）
export const ROTATION_DISTRIBUTION = {
  spine: 0.15, // 15%
  chest: 0.25, // 25%
  head: 0.6, // 60%
} as const

// デフォルトの足の長さ（キャリブレーション前のフォールバック）
export const DEFAULT_LEG_LENGTH = 0.8

// コントローラーの回転オフセット（VRM の T ポーズとコントローラーの grip の姿勢の差を補正）
// VRM 1.0 はアバターが +Z を向くため、Y 軸の回転は左 45°・右 -45°
export const CONTROLLER_ROTATION_OFFSET_LEFT = new Quaternion().setFromEuler(
  new Euler(Math.PI, Math.PI / 4, -Math.PI / 2, 'ZYX'),
)
export const CONTROLLER_ROTATION_OFFSET_RIGHT = new Quaternion().setFromEuler(
  new Euler(Math.PI, -Math.PI / 4, Math.PI / 2, 'ZYX'),
)

// ハンドトラッキング用の回転オフセット（wristジョイントの座標系とVRM手首ボーンの差を補正）
// WebXR wrist: Y軸が手先方向、Z軸が手のひら法線方向
// Tポーズで手のひらが下、手先が横を向くよう補正（左右で鏡像関係）
export const HAND_TRACKING_ROTATION_OFFSET_LEFT = new Quaternion().setFromEuler(
  new Euler(0, -Math.PI / 4, -Math.PI / 2),
)
export const HAND_TRACKING_ROTATION_OFFSET_RIGHT = new Quaternion().setFromEuler(
  new Euler(0, Math.PI / 4, Math.PI / 2),
)

/**
 * コントローラーの握りの中心（gripSpace の原点）が、手首から中指の付け根までのどのあたりにあるか。
 * gripSpace の原点は「握りこぶしの中心」なので、手首をそこへ合わせると手が前に出る
 */
export const GRIP_PALM_RATIO = 0.75

/** 中指の付け根のボーンが無いアバターでの、手首から中指の付け根までの長さ（m） */
export const DEFAULT_PALM_LENGTH = 0.08

/**
 * 手首から握りの中心までのベクトルを、手のボーンのローカル座標で求める
 * 正規化ボーンは基本姿勢の回転が単位なので、子ボーンの position がそのまま手のローカルの向きになる
 * @param hand 手首のボーン（position は前腕からのずれ＝手の伸びる向き）
 * @param middleProximal 中指の付け根のボーン（無いアバターもある）
 */
export function getGripLocalOffset(
  hand: Object3D,
  middleProximal: Object3D | null | undefined,
  out: Vector3,
): Vector3 {
  if (middleProximal) return out.copy(middleProximal.position).multiplyScalar(GRIP_PALM_RATIO)
  return out
    .copy(hand.position)
    .normalize()
    .multiplyScalar(DEFAULT_PALM_LENGTH * GRIP_PALM_RATIO)
}

/**
 * 握りの中心の位置から手首の位置を求める
 * @param gripWorldPos 握りの中心（ワールド）
 * @param handWorldQuat 手のボーンのワールド回転
 * @param gripLocalOffset 手首から握りの中心まで（手のローカル、getGripLocalOffset）
 * @param worldScale 手のボーンのワールドのスケール
 */
export function gripToWristPosition(
  gripWorldPos: Vector3,
  handWorldQuat: Quaternion,
  gripLocalOffset: Vector3,
  worldScale: number,
  out: Vector3,
): Vector3 {
  // out と gripWorldPos が同じでもよいよう、ずれは別の Vector3 で求める
  const shift = _gripShift
    .copy(gripLocalOffset)
    .multiplyScalar(worldScale)
    .applyQuaternion(handWorldQuat)
  return out.copy(gripWorldPos).sub(shift)
}

/** 左右のコントローラー回転オフセットを取得する */
export function getControllerRotationOffset(isLeft: boolean): Quaternion {
  return isLeft ? CONTROLLER_ROTATION_OFFSET_LEFT : CONTROLLER_ROTATION_OFFSET_RIGHT
}

// 再利用するオブジェクト（パフォーマンス最適化）
const _tempVec = new Vector3()
const _tempVec2 = new Vector3()
const _tempVec3 = new Vector3()
const _tempQuat = new Quaternion()
const _gripShift = new Vector3()

// 足のボーン名パターン（アニメーションから抽出する対象）
// 例: Normalized_J_Bip_L_UpperLeg, Normalized_J_Bip_R_UpperLeg
export const LEG_BONE_PATTERNS = ['UpperLeg', 'LowerLeg', 'Foot', 'ToeBase']

/**
 * VRMAnimationから足のボーンのみを含むAnimationClipを作成する
 */
export function createLegOnlyAnimationClip(animation: VRMAnimation, vrm: VRM): AnimationClip {
  const fullClip = createVRMAnimationClip(animation, vrm)

  const legTracks = fullClip.tracks.filter((track) =>
    LEG_BONE_PATTERNS.some((pattern) => track.name.includes(pattern)),
  )

  return new AnimationClip(`legAnimation_${fullClip.name}`, fullClip.duration, legTracks)
}

/**
 * 重力ベースの肘ポールベクトルを計算する
 */
export function computeGravityBasedPoleVector(
  shoulderPos: Vector3,
  targetPos: Vector3,
  isLeftArm: boolean,
  sceneWorldQuat: Quaternion,
): Vector3 {
  const targetDir = targetPos.clone().sub(shoulderPos).normalize()

  // VRM 1.0 はアバターが +Z を向くので、左腕の外側は +X・右腕の外側は -X（アバターのローカル）
  const outwardDir = new Vector3(isLeftArm ? 1 : -1, 0, 0).applyQuaternion(sceneWorldQuat)

  const downDir = new Vector3(0, -1, 0)

  const poleHint = new Vector3()
    .addScaledVector(outwardDir, 0.7)
    .addScaledVector(downDir, 0.5)
    .normalize()

  const dot = poleHint.dot(targetDir)
  const pole = poleHint.clone().sub(targetDir.clone().multiplyScalar(dot))

  if (pole.lengthSq() < 0.0001) {
    return downDir
      .clone()
      .sub(targetDir.clone().multiplyScalar(downDir.dot(targetDir)))
      .normalize()
  }

  return pole.normalize()
}

/**
 * Two-Bone IKを解決する
 */
export function solveTwoBoneIK(
  upperArm: Object3D,
  lowerArm: Object3D,
  hand: Object3D,
  targetWorldPos: Vector3,
  isLeftArm: boolean,
  sceneWorldQuat: Quaternion,
): void {
  upperArm.quaternion.identity()
  upperArm.updateMatrixWorld(true)
  lowerArm.quaternion.identity()
  lowerArm.updateMatrixWorld(true)

  const upperArmWorldPos = _tempVec.setFromMatrixPosition(upperArm.matrixWorld)
  const lowerArmWorldPos = _tempVec2.setFromMatrixPosition(lowerArm.matrixWorld)
  const handWorldPos = _tempVec3.setFromMatrixPosition(hand.matrixWorld)

  const upperArmLength = upperArmWorldPos.distanceTo(lowerArmWorldPos)
  const lowerArmLength = lowerArmWorldPos.distanceTo(handWorldPos)
  const totalLength = upperArmLength + lowerArmLength

  const shoulderToTarget = targetWorldPos.clone().sub(upperArmWorldPos)
  const targetDistance = shoulderToTarget.length()

  const minDistance = Math.abs(upperArmLength - lowerArmLength) + 0.001
  const maxDistance = totalLength - 0.001
  const clampedDistance = Math.max(minDistance, Math.min(targetDistance, maxDistance))

  const cosShoulderAngle =
    (upperArmLength * upperArmLength +
      clampedDistance * clampedDistance -
      lowerArmLength * lowerArmLength) /
    (2 * upperArmLength * clampedDistance)
  const shoulderAngle = Math.acos(Math.max(-1, Math.min(1, cosShoulderAngle)))

  const targetDir = shoulderToTarget.clone().normalize()

  const poleDir = computeGravityBasedPoleVector(
    upperArmWorldPos,
    targetWorldPos,
    isLeftArm,
    sceneWorldQuat,
  )

  const elbowDir = targetDir.clone()
  const rotationAxis = targetDir.clone().cross(poleDir).normalize()

  if (rotationAxis.lengthSq() > 0.0001) {
    const elbowRotation = new Quaternion().setFromAxisAngle(rotationAxis, shoulderAngle)
    elbowDir.applyQuaternion(elbowRotation)
  }

  const initialUpperArmDir = lowerArmWorldPos.clone().sub(upperArmWorldPos).normalize()
  const targetUpperArmDir = elbowDir.clone().normalize()

  const upperArmRotation = new Quaternion().setFromUnitVectors(
    initialUpperArmDir,
    targetUpperArmDir,
  )

  const upperArmParentWorldQuat = _tempQuat.identity()
  if (upperArm.parent) {
    upperArm.parent.getWorldQuaternion(upperArmParentWorldQuat)
  }
  const upperArmLocalQuat = upperArmParentWorldQuat
    .clone()
    .invert()
    .multiply(upperArmRotation)
    .multiply(upperArmParentWorldQuat)

  upperArm.quaternion.copy(upperArmLocalQuat)
  upperArm.updateMatrixWorld(true)

  const newLowerArmWorldPos = _tempVec2.setFromMatrixPosition(lowerArm.matrixWorld)
  const newHandWorldPos = _tempVec3.setFromMatrixPosition(hand.matrixWorld)
  const initialLowerArmDir = newHandWorldPos.clone().sub(newLowerArmWorldPos).normalize()
  const targetLowerArmDir = targetWorldPos.clone().sub(newLowerArmWorldPos).normalize()

  const lowerArmRotation = new Quaternion().setFromUnitVectors(
    initialLowerArmDir,
    targetLowerArmDir,
  )

  const lowerArmParentWorldQuat = new Quaternion()
  lowerArm.parent?.getWorldQuaternion(lowerArmParentWorldQuat)
  const lowerArmLocalQuat = lowerArmParentWorldQuat
    .clone()
    .invert()
    .multiply(lowerArmRotation)
    .multiply(lowerArmParentWorldQuat)

  lowerArm.quaternion.copy(lowerArmLocalQuat)
  lowerArm.updateMatrixWorld(true)
}

/**
 * gripのワールド回転をボーンのローカル回転に変換して適用
 */
export function applyGripRotationToBone(
  bone: Object3D,
  gripWorldQuat: Quaternion,
  offset: Quaternion,
): void {
  if (!bone.parent) {
    bone.quaternion.copy(gripWorldQuat).multiply(offset)
    return
  }

  const parentWorldQuat = new Quaternion()
  bone.parent.getWorldQuaternion(parentWorldQuat)
  parentWorldQuat.invert()

  const localQuat = gripWorldQuat.clone().premultiply(parentWorldQuat).multiply(offset)
  bone.quaternion.copy(localQuat)
}

/**
 * 上半身の回転を適用（spine/chest/headに回転を分散）
 * yawは3ボーンに分散、pitch/roll（首かしげ）はheadのみに適用
 */
export function applyUpperBodyRotation(vrm: VRM, yaw: number, pitch: number, roll = 0): void {
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine')
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest')
  const head = vrm.humanoid?.getNormalizedBoneNode('head')

  if (spine) {
    spine.quaternion.setFromEuler(new Euler(0, yaw * ROTATION_DISTRIBUTION.spine, 0, 'YXZ'))
    spine.updateMatrixWorld(true)
  }

  if (chest) {
    chest.quaternion.setFromEuler(new Euler(0, yaw * ROTATION_DISTRIBUTION.chest, 0, 'YXZ'))
    chest.updateMatrixWorld(true)
  }

  if (head) {
    head.quaternion.setFromEuler(new Euler(pitch, yaw * ROTATION_DISTRIBUTION.head, roll, 'YXZ'))
    head.updateMatrixWorld(true)
  }
}

/**
 * しゃがみ時の膝曲げを適用
 */
export function applyKneeBend(vrm: VRM, hipsDropAmount: number, legLength: number): void {
  const leftUpperLeg = vrm.humanoid?.getNormalizedBoneNode('leftUpperLeg')
  const leftLowerLeg = vrm.humanoid?.getNormalizedBoneNode('leftLowerLeg')
  const rightUpperLeg = vrm.humanoid?.getNormalizedBoneNode('rightUpperLeg')
  const rightLowerLeg = vrm.humanoid?.getNormalizedBoneNode('rightLowerLeg')

  const bendRatio = Math.min(1, hipsDropAmount / legLength)
  const kneeBendAngle = bendRatio * Math.PI * 1.1
  const hipBendAngle = bendRatio * Math.PI * 0.55

  // VRM 1.0 はアバターが +Z を向くので、太ももを前へ上げる回転は X 軸回りの負
  const sign = -1

  if (leftUpperLeg && leftLowerLeg) {
    leftUpperLeg.rotation.x = sign * hipBendAngle
    leftLowerLeg.rotation.x = sign * -kneeBendAngle
    leftUpperLeg.updateMatrixWorld(true)
    leftLowerLeg.updateMatrixWorld(true)
  }

  if (rightUpperLeg && rightLowerLeg) {
    rightUpperLeg.rotation.x = sign * hipBendAngle
    rightLowerLeg.rotation.x = sign * -kneeBendAngle
    rightUpperLeg.updateMatrixWorld(true)
    rightLowerLeg.updateMatrixWorld(true)
  }
}
