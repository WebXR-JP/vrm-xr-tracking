import { Quaternion, Vector3 } from 'three'
import {
  type ControllerTransform,
  computeFingerCurls,
  computeFingerSpread,
  type FingerCurls,
  type FingerSpread,
} from '../src'
import { type PosePreset, presetHand, type Side, specWristQuat } from './poses'
import { handAxesInWrist, type ReplayData, type ReplayHand } from './replay'

/** VR に入らずにアバターへ渡す片手 */
export interface SimHand {
  /** パッケージに渡す手首（か握り）の位置と向き */
  transform: ControllerTransform
  /** 本当の指先と手のひらの向き（アバターの手と比べる。分からなければ null） */
  finger: Vector3 | null
  palm: Vector3 | null
  /** 関節の位置（ワールド。ハンドトラッキングのログのときだけ） */
  joints: Vector3[]
  /** 指ごとの曲がり（関節のログがあるときだけ） */
  curls: FingerCurls | null
  /** 指の開き（度。関節のログがあるときだけ） */
  spread: FingerSpread | null
  /** 端末の wrist が仕様からどれだけずれているか（度。関節があるときだけ） */
  specDeviation: { finger: number; palm: number } | null
}

/** VR に入らずにアバターへ渡す 1 フレーム（ユーザーは -Z を向いて立っている） */
export interface SimFrame {
  /** 立ち姿勢の頭（目）の位置。アバターはこの真下に置く */
  headPosition: Vector3
  /** 頭の pitch（rad、下向きが正） */
  headPitch: number
  /** ユーザーの目が立ち姿勢（headPosition）からどれだけ動いたか（ワールド） */
  headChange: Vector3
  hands: Record<Side, SimHand | null>
}

/** 頭の向きの操作 */
export interface SimHead {
  /** 下を向く角度（rad、下向きが正） */
  pitch: number
  /** 首を軸に頭を回す（目が弧を描く）。false なら目はその場で向きだけ変える */
  pivotOnNeck: boolean
}

/**
 * 首の回転の軸から見た目の位置（m。ユーザーは -Z 向き）
 * 人が下を向くときは首の付け根あたりを軸に頭が回るので、目は前へ出ながら下がる。そのおおよその値
 */
export const NECK_TO_EYE_UP = 0.1
export const NECK_TO_EYE_FORWARD = 0.08

const X_AXIS = new Vector3(1, 0, 0)

/**
 * 首を軸に pitch だけ下を向いたとき、目が立ち姿勢からどれだけ動くか（ワールド、ユーザーは -Z 向き）
 * 首から見た目の位置を X 軸回りに回し、元の位置を引く。下向き（pitch が正）は -X 回りの回転になる
 */
export function computeHeadChange(pitch: number, pivotOnNeck: boolean): Vector3 {
  if (!pivotOnNeck) return new Vector3()
  const neckToEye = new Vector3(0, NECK_TO_EYE_UP, -NECK_TO_EYE_FORWARD)
  const rotation = new Quaternion().setFromAxisAngle(X_AXIS, -pitch)
  return neckToEye.clone().applyQuaternion(rotation).sub(neckToEye)
}

/** ユーザーの目（カメラが来る場所）の位置 */
export function eyePositionOf(sim: SimFrame): Vector3 {
  return sim.headPosition.clone().add(sim.headChange)
}

const DEFAULT_HEAD = new Vector3(0, 1.6, 0)
const SPEC_FINGER = new Vector3(0, 0, -1)
const SPEC_PALM = new Vector3(0, -1, 0)

/** 端末の wrist が仕様（指先 -Z・手のひら -Y）からどれだけずれているか（度） */
function specDeviation(axes: { finger: Vector3; palm: Vector3 } | null) {
  if (!axes) return null
  return {
    finger: Math.round(axes.finger.angleTo(SPEC_FINGER) * (180 / Math.PI)),
    palm: Math.round(axes.palm.angleTo(SPEC_PALM) * (180 / Math.PI)),
  }
}

/** ログの関節から指ごとの曲がりを求める */
function spreadOf(hand: ReplayHand | null): FingerSpread | null {
  if (!hand?.joints) return null
  const joints = hand.joints
  return computeFingerSpread((name) => joints.get(name)?.position)
}

function curlsOf(hand: ReplayHand | null, side: Side): FingerCurls | null {
  if (!hand?.joints) return null
  const joints = hand.joints
  return computeFingerCurls((name) => joints.get(name)?.position, undefined, side)
}

function jointsInWorld(hand: ReplayHand, transform: ControllerTransform): Vector3[] {
  if (!hand.joints) return []
  return [...hand.joints.values()].map((joint) =>
    joint.position.clone().applyQuaternion(transform.rotation).add(transform.position),
  )
}

/**
 * 見本のポーズで片手を作る
 *
 * 関節のログがあれば、その端末の手の形（指先・手のひらの本当の向き）が見本のポーズになるよう
 * wrist を回す。端末の wrist が仕様とずれていれば、そのずれがそのままアバターに出る
 */
function presetSimHand(preset: PosePreset, side: Side, replay: ReplayHand | null): SimHand {
  const target = presetHand(preset.hands[side])
  const wristOfTarget = specWristQuat(target.finger, target.palm)
  const axes = replay?.joints ? handAxesInWrist(replay.joints, side) : null
  // 端末の手の向き（wrist から見た指先・手のひら）を、見本の向きへ合わせる回転
  const rotation = axes
    ? wristOfTarget.clone().multiply(specWristQuat(axes.finger, axes.palm).invert())
    : wristOfTarget
  const transform: ControllerTransform = {
    position: target.position,
    rotation,
    isHandTracking: true,
  }
  return {
    transform,
    finger: target.finger,
    palm: target.palm,
    joints: replay ? jointsInWorld(replay, transform) : [],
    curls: curlsOf(replay, side),
    spread: spreadOf(replay),
    specDeviation: specDeviation(axes),
  }
}

/** ログの姿勢（tracking calibration）そのままで片手を作る */
function recordedSimHand(hand: ReplayHand, side: Side): SimHand | null {
  if (!hand.pose) return null
  const isHandTracking = !!hand.joints
  const transform: ControllerTransform = {
    position: hand.pose.position.clone(),
    rotation: hand.pose.quaternion.clone(),
    isHandTracking,
  }
  const axes = hand.joints ? handAxesInWrist(hand.joints, side) : null
  return {
    transform,
    finger: axes ? axes.finger.clone().applyQuaternion(transform.rotation) : null,
    palm: axes ? axes.palm.clone().applyQuaternion(transform.rotation) : null,
    joints: jointsInWorld(hand, transform),
    curls: curlsOf(hand, side),
    spread: spreadOf(hand),
    specDeviation: specDeviation(axes),
  }
}

/**
 * 見本のポーズ（とログの手の形）から 1 フレームを作る
 * @param useRecordedPose ログに姿勢（tracking calibration）があれば、見本ではなくそれを使う
 * @param head 頭の向き（ログの姿勢を使うときも効かせる）
 */
export function buildSimFrame(
  preset: PosePreset,
  replay: ReplayData | null,
  useRecordedPose: boolean,
  head: SimHead,
): SimFrame {
  // ログの頭の高さは、ログの姿勢をそのまま使うときだけ（見本のポーズの手は目の高さ 1.6m の人に合わせてある）
  const useRecorded = useRecordedPose && !!replay && Object.values(replay.hands).some((h) => h.pose)
  const headPosition =
    useRecorded && replay?.headHeight ? new Vector3(0, replay.headHeight, 0) : DEFAULT_HEAD.clone()
  const hand = (side: Side): SimHand | null => {
    const replayHand = replay?.hands[side] ?? null
    if (useRecorded && replayHand?.pose) {
      return recordedSimHand(replayHand, side)
    }
    return presetSimHand(preset, side, replayHand)
  }
  return {
    headPosition,
    headPitch: head.pitch,
    headChange: computeHeadChange(head.pitch, head.pivotOnNeck),
    hands: { left: hand('left'), right: hand('right') },
  }
}
