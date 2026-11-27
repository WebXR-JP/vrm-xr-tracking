import type { VRM } from '@pixiv/three-vrm'
import { type Object3D, Quaternion, Vector3 } from 'three'
import {
  applyKneeBend,
  computeTorsoBendProgress,
  DEFAULT_LEG_LENGTH,
  DEFAULT_TORSO_BEND,
  KNEE_BEND_DEADZONE,
  type TorsoBendConfig,
} from './vrIK.js'
import { HEAD_TO_EYE_OFFSET } from './xrOrigin.js'

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
 * node のローカルの点 localPoint が、いまの姿勢で hips の原点からどこにあるかを求める
 * （hips の親の座標軸で。hips 自身の回転も含める）
 * ワールド行列は使わず、親をたどって回転と位置を重ねる（行列の更新に頼らない）
 * @returns node が hips の下に無ければ false（out は使えない）
 */
export function computePosedOffsetFromHips(
  node: Object3D,
  localPoint: Vector3,
  hips: Object3D,
  out: Vector3,
): boolean {
  out.copy(localPoint)
  let current: Object3D | null = node
  while (current && current !== hips) {
    out.applyQuaternion(current.quaternion).add(current.position)
    current = current.parent
  }
  if (!current) return false
  // 腰の位置は求めたいもの（腰を置く場所）なので足さず、回転だけ掛ける
  out.applyQuaternion(hips.quaternion)
  return true
}

/**
 * computePosedOffsetFromHips の基本姿勢（全ボーンの回転なし）版
 * 正規化ボーンは基本姿勢の回転が単位なので、position を足すだけでよい。姿勢に依らない
 * @returns node が hips の下に無ければ false（out は使えない）
 */
export function computeRestOffsetFromHips(
  node: Object3D,
  localPoint: Vector3,
  hips: Object3D,
  out: Vector3,
): boolean {
  out.copy(localPoint)
  let current: Object3D | null = node
  while (current && current !== hips) {
    out.add(current.position)
    current = current.parent
  }
  return current !== null
}

const ZERO = new Vector3()
const _eyeHeadLocal = new Vector3()
const _eyeOtherSide = new Vector3()
const _eyePosed = new Vector3()
const _eyeRest = new Vector3()

/**
 * 腰から見た目の位置を、いまの姿勢（outPosed）と基本姿勢（outRest）で求める
 * 目のボーンが両方あればその中点（頭の中心で回るように）、無ければ head のローカルで上へ HEAD_TO_EYE_OFFSET
 * @returns head も無い・hips の下に無いときは false
 */
function computeEyeOffsetsFromHips(
  vrm: VRM,
  hips: Object3D,
  outPosed: Vector3,
  outRest: Vector3,
): boolean {
  const leftEye = vrm.humanoid?.getNormalizedBoneNode('leftEye')
  const rightEye = vrm.humanoid?.getNormalizedBoneNode('rightEye')
  if (leftEye && rightEye) {
    if (!computePosedOffsetFromHips(leftEye, ZERO, hips, outPosed)) return false
    if (!computePosedOffsetFromHips(rightEye, ZERO, hips, _eyeOtherSide)) return false
    outPosed.add(_eyeOtherSide).multiplyScalar(0.5)
    computeRestOffsetFromHips(leftEye, ZERO, hips, outRest)
    computeRestOffsetFromHips(rightEye, ZERO, hips, _eyeOtherSide)
    outRest.add(_eyeOtherSide).multiplyScalar(0.5)
    return true
  }

  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  if (!head) return false
  _eyeHeadLocal.set(0, HEAD_TO_EYE_OFFSET, 0)
  if (!computePosedOffsetFromHips(head, _eyeHeadLocal, hips, outPosed)) return false
  computeRestOffsetFromHips(head, _eyeHeadLocal, hips, outRest)
  return true
}

const _headQuatFromHips = new Quaternion()
const _headForward = new Vector3()
const _headUp = new Vector3()

/** 水平成分がこれより短ければ、頭の方位が決まらないとみなして引かない */
const MIN_PULL_BACK_DIRECTION = 1e-6

/**
 * 頭のボーンのいまの向きから、下を向いた進み具合（computeTorsoBendProgress、0〜1）と、
 * 体を引く向き（hips の親の座標軸の水平の単位ベクトル。Y は 0）を求める
 * applyUpperBodyRotation の後に呼ぶ前提。
 * 引く向きは頭の前 f と頭の上 u を足したものの水平成分の逆。真下を向くと f の水平成分は消えるが
 * u が前を向くので、0〜90° のどこでも頭が向いている方位が取れる
 * @param outDirection 引く向き。方位が決まらないときは 0
 * @returns 進み具合。head が無い・hips の下に無いときは 0
 */
function computeLookDown(
  vrm: VRM,
  hips: Object3D,
  torsoBend: TorsoBendConfig,
  outDirection: Vector3,
): number {
  outDirection.set(0, 0, 0)
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  if (!head) return 0

  // head から hips まで回転だけ重ねる（hips の回転も含める）
  const q = _headQuatFromHips.copy(head.quaternion)
  let current: Object3D | null = head.parent
  while (current && current !== hips) {
    q.premultiply(current.quaternion)
    current = current.parent
  }
  if (!current) return 0
  q.premultiply(hips.quaternion)

  const forward = _headForward.set(0, 0, 1).applyQuaternion(q)
  const up = _headUp.set(0, 1, 0).applyQuaternion(q)

  // 下向きが正（上向きは負なので進み具合は 0）
  const pitch = Math.asin(Math.min(1, Math.max(-1, -forward.y)))
  const progress = computeTorsoBendProgress(pitch, torsoBend)
  if (progress === 0) return 0

  const dirX = forward.x + up.x
  const dirZ = forward.z + up.z
  const length = Math.hypot(dirX, dirZ)
  if (length >= MIN_PULL_BACK_DIRECTION) outDirection.set(-dirX / length, 0, -dirZ / length)
  return progress
}

const _pullBack = new Vector3()

/**
 * updateHipsFromHeadTracking が膝を曲げた VRM。遊び以下に戻ったとき、ここに入っていれば 1 回だけ脚を 0 に戻す。
 * 止まっているときは脚のアニメーションが無く、最後に書いた膝の角度が残って、顔を上げても膝が曲がったままになるため
 */
const _kneeBentVrms = new WeakSet<VRM>()

/**
 * 頭の相対移動量からhips位置を更新し、しゃがみ時は膝曲げを適用
 * relativeHeadChange/initialHipsPosがnullまたはisRapidMovementの場合はスキップ
 *
 * 腰は「アバターの目がカメラの位置に来る」ところへ置く:
 * hips.position = initialHipsPos + relativeHeadChange − (e − e0)
 * （e: いまの姿勢で腰から見た目の位置、e0: 基本姿勢での同じ値）。
 * 首を軸に目が前へ出る分・背中を曲げて頭が前へ出る分・首を振って目が弧を描く分がまとめて打ち消され、
 * 下を向くと腰が後ろへ下がって、胴が目の真下から外れる（床が見える）。
 *
 * さらに下を向いたときだけ、背中の曲げと同じ進み具合 t で
 * - 体全体を水平に後ろ（頭が向いている方位の逆）へ t × torsoBend.pullBack 引く（既定は最大 12cm）。
 *   胸を視界の外へ出すため。一人称では頭を描かないので本人には分からないが、アバターの目はその分カメラより後ろへずれる
 * - 腰を t × torsoBend.kneeDrop 落として屈伸する（既定は最大 6cm）。その分アバターの目はカメラより低くなる
 * pullBack・kneeDrop を 0 にすると、それぞれしない（両方 0 で目がカメラに一致する）。head が無いアバターではどちらもしない。
 *
 * 膝は、腰が立ち姿勢から落ちた量（屈伸の分も含む）から computeKneeBendAngles の角度で曲げる（足が床に残る）。
 * 落ちた量が KNEE_BEND_DEADZONE 以下なら脚に触らない（脚のアニメーションを上書きしない）。
 * ただしこの関数が前に膝を曲げていた VRM では、遊び以下に戻った最初の 1 回だけ脚を 0（まっすぐ）に戻す
 *
 * 背中と頭の回転を読むので、**applyUpperBodyRotation の後に呼ぶこと**
 * @param torsoBend 体を後ろへ引く量（pullBack）・腰を落とす量（kneeDrop）と進み具合（startPitch・fullPitch）。
 *   省略すると DEFAULT_TORSO_BEND
 */
export function updateHipsFromHeadTracking(
  vrm: VRM,
  relativeHeadChange: Vector3 | null,
  initialHipsPos: Vector3 | null,
  isRapidMovement: boolean,
  legLength: number,
  torsoBend: TorsoBendConfig = DEFAULT_TORSO_BEND,
): void {
  if (!relativeHeadChange || !initialHipsPos || isRapidMovement) return

  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  if (!hips) return

  // 目の位置が求められないアバター（head も無いなど）では補正しない（今までの動き）
  const hasEye = computeEyeOffsetsFromHips(vrm, hips, _eyePosed, _eyeRest)
  const eyeShift = hasEye ? _eyePosed.sub(_eyeRest) : _eyePosed.set(0, 0, 0)

  // 下を向いた進み具合と、体を引く向き（水平のみ）
  const pullBack = _pullBack
  const lookDown = computeLookDown(vrm, hips, torsoBend, pullBack)
  pullBack.multiplyScalar(lookDown * torsoBend.pullBack)

  // 背中を曲げた分で腰を立ち姿勢より上げると足が浮くので、上げるのは頭が実際に上がった分まで。
  // そのぶんアバターの頭がカメラより少し低くなるのは許す（カメラの位置が正）
  const maxY = Math.max(0, relativeHeadChange.y)
  const correctedY = Math.min(relativeHeadChange.y - eyeShift.y, maxY)

  // 下を向いた分だけ屈伸する。そのあと腰が床を突き抜けない範囲に丸める
  // （膝を曲げる量も、この合計の落ちた量から求める。下を向いて頭が数 cm 下がった分は上の補正で消えるので、
  // しゃがみとはみなさない）
  const headChangeY = clampHipsDropY(correctedY - lookDown * torsoBend.kneeDrop, legLength)
  hips.position.set(
    initialHipsPos.x + relativeHeadChange.x - eyeShift.x + pullBack.x,
    initialHipsPos.y + headChangeY,
    initialHipsPos.z + relativeHeadChange.z - eyeShift.z + pullBack.z,
  )

  const hipsDropAmount = -headChangeY
  if (hipsDropAmount <= KNEE_BEND_DEADZONE) {
    // 遊び以下なら脚に触らない（脚のアニメーションを上書きしない）。
    // ただし前のフレームまでこの関数で曲げていたなら、曲げが残らないよう 1 回だけ脚を 0 に戻す
    if (!_kneeBentVrms.has(vrm)) return
    applyKneeBend(vrm, 0, legLength)
    _kneeBentVrms.delete(vrm)
    return
  }
  applyKneeBend(vrm, hipsDropAmount, legLength)
  _kneeBentVrms.add(vrm)
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
