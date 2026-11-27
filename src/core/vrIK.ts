import type { VRM } from '@pixiv/three-vrm'
import { createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'
import { AnimationClip, Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

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

// ハンドトラッキング用の回転オフセット（wrist ジョイントの向きから、手のボーンの向きへ）
// この後にコントローラーと同じ CONTROLLER_ROTATION_OFFSET_* を掛けるので、その分を打ち消しておく。
// grip を経由して合わせると、コントローラーのオフセットに入っている「握った棒の傾き」の 45° まで
// 手に掛かり、T ポーズで指先が前に 45° 曲がる。なので T ポーズで直接合わせる。
//
// T ポーズ（ユーザーは -Z を向き、腕を真横・手のひらを下）での wrist の向き（WebXR の仕様:
// -Z が指先の方、-Y が手のひらの外）と、そのときのアバターの手（VRM 1.0 は +Z 向きなので
// アバターは Y 軸に 180° 回っている。正規化ボーンは T ポーズで回転なし）から求める
const _basis = new Matrix4()
function quatFromBasis(x: Vector3, y: Vector3, z: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(_basis.makeBasis(x, y, z))
}
/** T ポーズでの wrist ジョイントの向き（右手は指先が +X、左手は -X） */
export const TPOSE_WRIST_RIGHT = quatFromBasis(
  new Vector3(0, 0, 1),
  new Vector3(0, 1, 0),
  new Vector3(-1, 0, 0),
)
export const TPOSE_WRIST_LEFT = quatFromBasis(
  new Vector3(0, 0, -1),
  new Vector3(0, 1, 0),
  new Vector3(1, 0, 0),
)
/** T ポーズでのアバターの手のボーンのワールドの向き（アバターが Y 軸に 180° 回っている） */
const TPOSE_HAND = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)

/** wrist · offset · コントローラーのオフセット が T ポーズで TPOSE_HAND になる offset */
function handTrackingOffset(tposeWrist: Quaternion, controllerOffset: Quaternion): Quaternion {
  return tposeWrist
    .clone()
    .invert()
    .multiply(TPOSE_HAND)
    .multiply(controllerOffset.clone().invert())
}
export const HAND_TRACKING_ROTATION_OFFSET_LEFT = handTrackingOffset(
  TPOSE_WRIST_LEFT,
  CONTROLLER_ROTATION_OFFSET_LEFT,
)
export const HAND_TRACKING_ROTATION_OFFSET_RIGHT = handTrackingOffset(
  TPOSE_WRIST_RIGHT,
  CONTROLLER_ROTATION_OFFSET_RIGHT,
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
 * 下を向いたときに背中を前へ曲げる量。VR で真下を見ると、直立した胴が目の真下にあって
 * 床が見えないので、VRChat のように背中を曲げる（腰を後ろへ逃がすのは updateHipsFromHeadTracking）。
 * 胴の前傾は spine・chest・upperChest の 3 か所に分けてなめらかな弧にし、残りの傾きの一部を首（neck）が持つ。
 * 角度は rad、長さは m（vrm.scene のローカル）
 */
export interface TorsoBendConfig {
  /** 背中を曲げ始める下向きの角度（これより浅い下向き・上向きでは曲げない） */
  startPitch: number
  /** 背中の曲げが最大になる下向きの角度 */
  fullPitch: number
  /** spine の前傾の最大 */
  maxSpine: number
  /** chest の前傾の最大 */
  maxChest: number
  /** upperChest の前傾の最大。upperChest が無いアバターでは、この分を chest に足す（合計の前傾は変わらない） */
  maxUpperChest: number
  /**
   * 頭の前後の傾きのうち、胴で曲げた残りを首（neck）が受け持つ割合（0〜1）。
   * neck の前後の傾き = (pitch − 胴の前傾の合計) × neckShare。上向きにも効く。neck が無ければ頭が全部持つ
   */
  neckShare: number
  /**
   * 下を向ききったときに体全体を後ろへ引く最大の量（m）。
   * 曲げと同じ進み具合で増やす。updateHipsFromHeadTracking が使う（0 で引かない）
   */
  pullBack: number
  /**
   * 下を向ききったときに腰を落とす（屈伸する）最大の量（m）。
   * 曲げと同じ進み具合で増やし、落とした分は膝を曲げる。updateHipsFromHeadTracking が使う（0 で落とさない）
   */
  kneeDrop: number
}

/** 背中の曲げの既定値。実機で見ながら調整する値 */
export const DEFAULT_TORSO_BEND: TorsoBendConfig = {
  startPitch: (15 * Math.PI) / 180,
  fullPitch: (75 * Math.PI) / 180,
  maxSpine: (10 * Math.PI) / 180,
  maxChest: (12 * Math.PI) / 180,
  maxUpperChest: (12 * Math.PI) / 180,
  neckShare: 0.4,
  // 背中を曲げても胸の前面が目のすぐ後ろ下に残って視界に入るので、胸を視界の外へ出すために引く。
  // 一人称では頭を描かないので分からないが、アバターの目とカメラはこの分ずれる。実機で調整する値
  pullBack: 0.12,
  // 脚がまっすぐのまま上体だけ曲げると不自然なので、下を向いたら少し屈伸する。実機で調整する値
  kneeDrop: 0.06,
}

/**
 * 頭の pitch（下向きが正）から、背中を曲げる進み具合（0〜1）を求める
 * 開始角から最大角まで smoothstep でなめらかに増やす（曲げ始めと曲げ終わりで急に変わらないように）。
 * 最大角が開始角以下のときは、開始角を超えたら 1 にする（0 で割らないように）
 */
export function computeTorsoBendProgress(
  pitch: number,
  config: TorsoBendConfig = DEFAULT_TORSO_BEND,
): number {
  const { startPitch, fullPitch } = config
  const range = fullPitch - startPitch
  const linear = range > 0 ? (pitch - startPitch) / range : pitch > startPitch ? 1 : 0
  const clamped = Math.min(1, Math.max(0, linear))
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * 頭の pitch（下向きが正）から、spine・chest・upperChest の前傾（rad、+X 回りで正が前）を求める
 * 進み具合は computeTorsoBendProgress（開始角から最大角まで smoothstep）。
 * upperChest が無いアバターで chest へ足すのは applyUpperBodyRotation が行う（ここでは骨格を見ない）
 */
export function computeTorsoBend(
  pitch: number,
  config: TorsoBendConfig = DEFAULT_TORSO_BEND,
): { spine: number; chest: number; upperChest: number } {
  const { maxSpine, maxChest, maxUpperChest } = config
  const t = computeTorsoBendProgress(pitch, config)
  return { spine: t * maxSpine, chest: t * maxChest, upperChest: t * maxUpperChest }
}

const _upperBodyEuler = new Euler()
const _torsoQuat = new Quaternion()
const _headTargetQuat = new Quaternion()

/**
 * 上半身の回転を適用する
 * - yaw は spine・chest・head に分ける（ROTATION_DISTRIBUTION）
 * - 下を向いた分（computeTorsoBend）だけ spine・chest・upperChest を前へ倒して背骨を弧にする。
 *   upperChest が無いアバターでは、その分を chest に足す（合計の前傾は変えない）
 * - neck は、pitch から胴で倒した分を引いた残りの neckShare 倍だけ前後に傾ける（X 軸回りだけ。上向きにも効く）
 * - head は、hips から見た向きがカメラの向き（Euler(pitch, yaw, roll, 'YXZ')）と一致するよう、残りを受け持つ
 *
 * upperChest と neck も毎フレーム書く（曲げが 0 なら単位回転）。アニメーションなどで回した値は上書きされる
 * @param torsoBend 背中を曲げる量（省略すると DEFAULT_TORSO_BEND）
 */
export function applyUpperBodyRotation(
  vrm: VRM,
  yaw: number,
  pitch: number,
  roll = 0,
  torsoBend: TorsoBendConfig = DEFAULT_TORSO_BEND,
): void {
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine')
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest')
  const upperChest = vrm.humanoid?.getNormalizedBoneNode('upperChest')
  const neck = vrm.humanoid?.getNormalizedBoneNode('neck')
  const head = vrm.humanoid?.getNormalizedBoneNode('head')

  const bend = computeTorsoBend(pitch, torsoBend)
  // upperChest が無いアバターが多いので、その分は chest に足して合計の前傾を変えない
  const chestBend = upperChest ? bend.chest : bend.chest + bend.upperChest
  // spine から neck までで回した分を合わせたもの。頭の向きから打ち消すのに使う
  const torso = _torsoQuat.identity()
  // 胴（spine・chest・upperChest）で実際に倒した前傾の合計
  let appliedBend = 0

  if (spine) {
    spine.quaternion.setFromEuler(
      _upperBodyEuler.set(bend.spine, yaw * ROTATION_DISTRIBUTION.spine, 0, 'YXZ'),
    )
    spine.updateMatrixWorld(true)
    torso.multiply(spine.quaternion)
    appliedBend += bend.spine
  }

  if (chest) {
    chest.quaternion.setFromEuler(
      _upperBodyEuler.set(chestBend, yaw * ROTATION_DISTRIBUTION.chest, 0, 'YXZ'),
    )
    chest.updateMatrixWorld(true)
    torso.multiply(chest.quaternion)
    appliedBend += chestBend
  }

  if (upperChest) {
    upperChest.quaternion.setFromEuler(_upperBodyEuler.set(bend.upperChest, 0, 0, 'YXZ'))
    upperChest.updateMatrixWorld(true)
    torso.multiply(upperChest.quaternion)
    appliedBend += bend.upperChest
  }

  if (neck) {
    // 頭の付け根 1 か所で折れないよう、胴で倒した残りの一部を首に持たせる（yaw・roll は頭が持つ）
    const neckPitch = (pitch - appliedBend) * torsoBend.neckShare
    neck.quaternion.setFromEuler(_upperBodyEuler.set(neckPitch, 0, 0, 'YXZ'))
    neck.updateMatrixWorld(true)
    torso.multiply(neck.quaternion)
  }

  if (!head) return

  // 背中と首を曲げても、hips から見た頭の向きはカメラの向き（Euler(pitch, yaw, roll, 'YXZ')）のままにする。
  // spine・chest・upperChest・neck で回した分を逆に掛ければよい。
  // 曲げが 0 で pitch も 0 なら Euler(0, yaw×0.6, roll, 'YXZ') になり、今までと同じ
  _headTargetQuat.setFromEuler(_upperBodyEuler.set(pitch, yaw, roll, 'YXZ'))
  head.quaternion.copy(torso.invert()).multiply(_headTargetQuat)
  head.updateMatrixWorld(true)
}

/**
 * 膝を曲げ始めるまでの遊び（m）。腰の落ちた量からこれを引いた分で膝を曲げる。
 * 立っているときの頭の小さな上下で膝が震えないための遊び。引いて使うので、曲げ始めに段差は無い
 */
export const KNEE_BEND_DEADZONE = 0.03

/**
 * 膝の曲げ始めをなめらかにする幅（m）。遊びを超えた量 x から、脚を縮める量を x² / (x + KNEE_BEND_SOFTNESS) にする。
 * acos(1 − 縮める量 / 脚の長さ) は 0 での傾きが無限大なので、x をそのまま縮めると遊びを 1mm 超えただけで
 * 太もも約 3°・膝約 6° 曲がり、遊びの境目（既定値では下向き 45° あたり）で頭の小さな揺れに膝が震える。
 * x² で立ち上げると acos(1 − k·x²) ≈ √(2k)·x となり、曲げ始めの角度が x にほぼ比例する。
 * x が大きいと縮める量 ≈ x − KNEE_BEND_SOFTNESS になるので、足はその分（最大 2cm ほど）余分に床へ沈む。これは許す
 */
export const KNEE_BEND_SOFTNESS = 0.02

/**
 * 腰の落ちた量から、足を床に残す太ももと膝の曲げ（rad、どちらも正）を求める
 * 太ももとすねを同じ長さ（legLength / 2）とみなし、遊びを超えた量 x = max(0, drop − KNEE_BEND_DEADZONE) から
 * 縮める量 = x² / (x + KNEE_BEND_SOFTNESS) だけ脚を縮める角度にする:
 * 太ももの前への傾き a = acos(1 − 縮める量 / legLength)、膝の曲げ 2a（すねは鉛直から後ろへ a）。
 * 縮める量 / legLength は 0〜1 に丸める（脚の長さを超えても NaN にしない）
 */
export function computeKneeBendAngles(
  drop: number,
  legLength: number,
): { thigh: number; knee: number } {
  const x = Math.max(0, drop - KNEE_BEND_DEADZONE)
  // 曲げ始めをなめらかにする（KNEE_BEND_SOFTNESS を参照）
  const shorten = (x * x) / (x + KNEE_BEND_SOFTNESS)
  if (shorten === 0 || !(legLength > 0)) return { thigh: 0, knee: 0 }
  const ratio = Math.min(1, shorten / legLength)
  const thigh = Math.acos(1 - ratio)
  return { thigh, knee: thigh * 2 }
}

/**
 * しゃがみ時の膝曲げを適用（computeKneeBendAngles の角度で、足が床に残るように曲げる）
 * @param hipsDropAmount 腰が立ち姿勢から落ちた量（m）
 */
export function applyKneeBend(vrm: VRM, hipsDropAmount: number, legLength: number): void {
  const leftUpperLeg = vrm.humanoid?.getNormalizedBoneNode('leftUpperLeg')
  const leftLowerLeg = vrm.humanoid?.getNormalizedBoneNode('leftLowerLeg')
  const rightUpperLeg = vrm.humanoid?.getNormalizedBoneNode('rightUpperLeg')
  const rightLowerLeg = vrm.humanoid?.getNormalizedBoneNode('rightLowerLeg')

  const { thigh: hipBendAngle, knee: kneeBendAngle } = computeKneeBendAngles(
    hipsDropAmount,
    legLength,
  )

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
