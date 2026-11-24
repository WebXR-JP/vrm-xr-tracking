import { Vector3 } from 'three'
import type { FingerCurls, FingerName } from './types.js'

/** 指ごとの関節（WebXR Hand Input の名前。根元から指先へ） */
const FINGER_CHAINS: Record<FingerName, readonly XRHandJoint[]> = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: [
    'index-finger-metacarpal',
    'index-finger-phalanx-proximal',
    'index-finger-phalanx-intermediate',
    'index-finger-phalanx-distal',
    'index-finger-tip',
  ],
  middle: [
    'middle-finger-metacarpal',
    'middle-finger-phalanx-proximal',
    'middle-finger-phalanx-intermediate',
    'middle-finger-phalanx-distal',
    'middle-finger-tip',
  ],
  ring: [
    'ring-finger-metacarpal',
    'ring-finger-phalanx-proximal',
    'ring-finger-phalanx-intermediate',
    'ring-finger-phalanx-distal',
    'ring-finger-tip',
  ],
  little: [
    'pinky-finger-metacarpal',
    'pinky-finger-phalanx-proximal',
    'pinky-finger-phalanx-intermediate',
    'pinky-finger-phalanx-distal',
    'pinky-finger-tip',
  ],
}

export const FINGER_NAMES: readonly FingerName[] = ['thumb', 'index', 'middle', 'ring', 'little']

/**
 * 曲がりを 0〜1 にするときの、開いた手と握りきった手での「骨の向きの変化の和」（度）。
 * Quest 3・Android XR の実機の値から決めた（4本指は開いて 20〜45°、握って 170〜185°。
 * 親指は動きが小さく、開いて 10〜25°、握って 30〜40° ほど）
 */
const CURL_RANGE: Record<FingerName, { open: number; closed: number }> = {
  thumb: { open: 20, closed: 60 },
  index: { open: 30, closed: 180 },
  middle: { open: 30, closed: 180 },
  ring: { open: 30, closed: 180 },
  little: { open: 30, closed: 180 },
}

/** 関節の位置を名前で引く（座標系は何でもよい。手首から見た値でも、XR の基準空間でも） */
export type JointPositionLookup = (joint: XRHandJoint) => Vector3 | null | undefined

const _prev = new Vector3()
const _next = new Vector3()

/**
 * 1 本の指の「骨の向きの変化の和」（度）。関節が欠けていれば null
 */
export function measureFingerBend(
  finger: FingerName,
  getPosition: JointPositionLookup,
): number | null {
  const chain = FINGER_CHAINS[finger]
  const points: Vector3[] = []
  for (const joint of chain) {
    const p = getPosition(joint)
    if (!p) return null
    points.push(p)
  }
  let total = 0
  for (let i = 0; i + 2 < points.length; i++) {
    _prev.subVectors(points[i + 1], points[i])
    _next.subVectors(points[i + 2], points[i + 1])
    if (_prev.lengthSq() < 1e-12 || _next.lengthSq() < 1e-12) return null
    total += _prev.angleTo(_next)
  }
  return (total * 180) / Math.PI
}

/**
 * 手の関節の位置から、指ごとの曲がり（0=開く、1=握る）を求める
 *
 * 指の骨の向きが関節ごとにどれだけ変わったかを足し、開いた手〜握りきった手の幅で割る。
 * 指の横の開き（広げる・閉じる）は見ていない。関節が欠けた指は 0（開いた手）にする
 */
export function computeFingerCurls(
  getPosition: JointPositionLookup,
  out: FingerCurls = { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
): FingerCurls {
  for (const finger of FINGER_NAMES) {
    const bend = measureFingerBend(finger, getPosition)
    if (bend === null) {
      out[finger] = 0
      continue
    }
    const { open, closed } = CURL_RANGE[finger]
    out[finger] = Math.min(1, Math.max(0, (bend - open) / (closed - open)))
  }
  return out
}

const _jointPositions = new Map<XRHandJoint, Vector3>()

/**
 * XR の手（XRHand）から、指ごとの曲がりを求める。関節が 1 つも取れなければ null
 * @param baseSpace 関節の位置を測る空間（XR の基準空間など。曲がりは座標系によらない）
 */
export function readHandFingerCurls(
  frame: XRFrame,
  hand: XRHand,
  baseSpace: XRSpace,
  out?: FingerCurls,
): FingerCurls | null {
  if (!frame.getJointPose) return null
  let found = 0
  for (const chain of Object.values(FINGER_CHAINS)) {
    for (const joint of chain) {
      const space = hand.get(joint)
      const pose = space ? frame.getJointPose(space, baseSpace) : undefined
      let position = _jointPositions.get(joint)
      if (!pose) {
        _jointPositions.delete(joint)
        continue
      }
      if (!position) {
        position = new Vector3()
        _jointPositions.set(joint, position)
      }
      const p = pose.transform.position
      position.set(p.x, p.y, p.z)
      found++
    }
  }
  if (found === 0) return null
  return computeFingerCurls((joint) => _jointPositions.get(joint), out)
}
