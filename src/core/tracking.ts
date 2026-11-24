import type { VRM } from '@pixiv/three-vrm'
import { Vector3 } from 'three'
import { applyKneeBend, DEFAULT_LEG_LENGTH } from './vrIK.js'

// しゃがみ判定のしきい値（5cm以上下がったらしゃがみと判定）
export const CROUCH_THRESHOLD = 0.05
/**
 * 腰を下げてよい量の上限（脚の長さに対する比率）。ボタンのしゃがみ（原点を下げる）と実際の
 * しゃがみが重なると、頭の下がり幅が脚の長さを超えて腰が床より下へ沈むので、ここで止める
 */
export const MAX_HIPS_DROP_RATIO = 0.85

/** 頭の上下の変化量を、腰が床を突き抜けない範囲に丸める */
export function clampHipsDropY(headChangeY: number, legLength: number): number {
  return Math.max(headChangeY, -legLength * MAX_HIPS_DROP_RATIO)
}

// 急な位置変化のしきい値（1フレームで10cm以上の変化はテレポート/ジャンプと判定）
// 0.1m/frame × 72fps = 7.2 m/s — 自然な頭の動きでは到達しない速度
export const HEAD_CHANGE_THRESHOLD = 0.1

// キャリブレーション前のポーズ安定待ち
// Pico等では床原点がセッション開始から遅れて確定することがあり、
// 確定前のカメラ位置でキャリブレーションするとズレたまま固定される
export const POSE_STABLE_FRAMES_REQUIRED = 10
// 床基準でHMDがこの高さ未満なら未確定ポーズとみなす
export const POSE_PLAUSIBLE_MIN_CAMERA_Y = 0.3
// フレーム間のY変化がこれ未満なら安定とみなす
export const POSE_STABILITY_MAX_DELTA = 0.05
// 'local'等の目線原点ランタイムではカメラYが0付近のままになるため、高さチェックを免除するまでの時間
export const POSE_PLAUSIBILITY_TIMEOUT_MS = 2000

/**
 * キャリブレーション前のポーズ安定フレーム数を更新する
 * 「HMD高さが妥当」かつ「前フレームから安定」なら加算、崩れたら0に戻す
 * POSE_STABLE_FRAMES_REQUIRED に達したらキャリブレーション実行可能
 */
export function updatePoseStabilityCount(
  rawCameraY: number,
  prevRawCameraY: number | null,
  elapsedMs: number,
  currentCount: number,
): number {
  const isStable =
    prevRawCameraY !== null && Math.abs(rawCameraY - prevRawCameraY) < POSE_STABILITY_MAX_DELTA
  const isPlausible =
    rawCameraY > POSE_PLAUSIBLE_MIN_CAMERA_Y || elapsedMs >= POSE_PLAUSIBILITY_TIMEOUT_MS
  if (!isStable || !isPlausible) return 0
  return currentCount + 1
}

/**
 * フレーム間の移動量がしきい値を超えているか判定
 * 急な位置変化（移動/ジャンプなど）を検出する
 */
export function isRapidPositionChange(
  currentPos: Vector3,
  prevPos: Vector3 | null,
  threshold: number = HEAD_CHANGE_THRESHOLD,
): boolean {
  if (!prevPos) return false
  return currentPos.clone().sub(prevPos).length() > threshold
}

/**
 * 頭の相対移動量からhips位置を更新し、しゃがみ時は膝曲げを適用
 * relativeHeadChange/initialHipsPosがnullまたはisRapidMovementの場合はスキップ
 */
export function updateHipsFromHeadTracking(
  vrm: VRM,
  relativeHeadChange: Vector3 | null,
  initialHipsPos: Vector3 | null,
  isRapidMovement: boolean,
  legLength: number,
): void {
  if (!relativeHeadChange || !initialHipsPos || isRapidMovement) return

  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hips) return

  const headChangeY = clampHipsDropY(relativeHeadChange.y, legLength)
  hips.position.set(
    initialHipsPos.x + relativeHeadChange.x,
    initialHipsPos.y + headChangeY,
    initialHipsPos.z + relativeHeadChange.z,
  )

  const hipsDropAmount = -headChangeY
  if (hipsDropAmount > CROUCH_THRESHOLD) {
    applyKneeBend(vrm, hipsDropAmount, legLength)
  }
}

/**
 * VRMの足の長さを計測する
 * 左足の upperLeg → lowerLeg → foot の距離を合計
 */
export function measureLegLength(vrm: VRM): number {
  const leftUpperLeg = vrm.humanoid?.getNormalizedBoneNode('leftUpperLeg')
  const leftLowerLeg = vrm.humanoid?.getNormalizedBoneNode('leftLowerLeg')
  const leftFoot = vrm.humanoid?.getNormalizedBoneNode('leftFoot')

  if (!leftUpperLeg || !leftLowerLeg || !leftFoot) {
    return DEFAULT_LEG_LENGTH
  }

  const upperLegPos = new Vector3()
  const lowerLegPos = new Vector3()
  const footPos = new Vector3()

  leftUpperLeg.getWorldPosition(upperLegPos)
  leftLowerLeg.getWorldPosition(lowerLegPos)
  leftFoot.getWorldPosition(footPos)

  const upperLegLength = upperLegPos.distanceTo(lowerLegPos)
  const lowerLegLength = lowerLegPos.distanceTo(footPos)

  return upperLegLength + lowerLegLength
}
