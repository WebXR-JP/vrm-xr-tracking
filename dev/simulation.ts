import { Vector3 } from 'three'
import type { ControllerTransform } from '../src'
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
  /** 端末の wrist が仕様からどれだけずれているか（度。関節があるときだけ） */
  specDeviation: { finger: number; palm: number } | null
}

/** VR に入らずにアバターへ渡す 1 フレーム（ユーザーは -Z を向いて立っている） */
export interface SimFrame {
  headPosition: Vector3
  hands: Record<Side, SimHand | null>
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
    specDeviation: specDeviation(axes),
  }
}

/**
 * 見本のポーズ（とログの手の形）から 1 フレームを作る
 * @param useRecordedPose ログに姿勢（tracking calibration）があれば、見本ではなくそれを使う
 */
export function buildSimFrame(
  preset: PosePreset,
  replay: ReplayData | null,
  useRecordedPose: boolean,
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
  return { headPosition, hands: { left: hand('left'), right: hand('right') } }
}
