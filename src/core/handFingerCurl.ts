import { Vector3 } from 'three'
import { computeFingerSpread } from './fingerSpread.js'
import type { FingerCurls, FingerName, FingerSpread } from './types.js'

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

/**
 * 親指が手のひらの前へ回り込んだ角度（度）の、開いた手と握った手での値。
 * Quest 3・Android XR の実機の値から決めた（開いて 26〜33°、握って 66〜81°）
 */
const THUMB_SWING_RANGE = { open: 30, closed: 75 }

const _prev = new Vector3()
const _next = new Vector3()
const _finger = new Vector3()
const _across = new Vector3()
const _side = new Vector3()
const _palm = new Vector3()
const _thumb = new Vector3()

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
 * 親指が手のひらの前へ回り込んだ角度（度）。関節が欠けていれば null
 *
 * 手のひらの面で「親指の側（小指→人差し指の向き）」を 0°、「手のひらの外（手のひらが向く側）」を
 * 90° として、親指（付け根→指先）がどちらを向いているか。親指を立てる・横に開くと小さく、
 * 握る・手のひらの前へ寄せると大きくなる
 */
export function measureThumbSwing(
  getPosition: JointPositionLookup,
  handedness: 'left' | 'right',
): number | null {
  const wrist = getPosition('wrist')
  const middle = getPosition('middle-finger-phalanx-proximal')
  const index = getPosition('index-finger-phalanx-proximal')
  const pinky = getPosition('pinky-finger-phalanx-proximal')
  const thumbBase = getPosition('thumb-metacarpal')
  const thumbTip = getPosition('thumb-tip')
  if (!wrist || !middle || !index || !pinky || !thumbBase || !thumbTip) return null

  _finger.subVectors(middle, wrist)
  _across.subVectors(index, pinky)
  if (_finger.lengthSq() < 1e-12 || _across.lengthSq() < 1e-12) return null
  _finger.normalize()
  // 親指の側（指の向きに直交させる）
  _side.copy(_across).addScaledVector(_finger, -_across.dot(_finger))
  // 手のひらの外。右手は人差し指が親指側なので、左手と向きが逆になる
  _palm.crossVectors(_finger, _across)
  if (handedness === 'right') _palm.negate()
  if (_side.lengthSq() < 1e-12 || _palm.lengthSq() < 1e-12) return null
  _side.normalize()
  _palm.normalize()

  _thumb.subVectors(thumbTip, thumbBase)
  return (Math.atan2(_thumb.dot(_palm), _thumb.dot(_side)) * 180) / Math.PI
}

const toCurl = (value: number, { open, closed }: { open: number; closed: number }) =>
  Math.min(1, Math.max(0, (value - open) / (closed - open)))

/**
 * 手の関節の位置から、指ごとの曲がり（0=開く、1=握る）を求める
 *
 * 指の骨の向きが関節ごとにどれだけ変わったかを足し、開いた手〜握りきった手の幅で割る。
 * 親指は曲げるより手のひらの前へ回り込む動きが大きいので、手の左右が分かれば
 * 回り込みの角度も見て、大きいほうを使う（アバターの親指は手のひらの前へ回り込むように曲がる）。
 * 指の横の開き（広げる・閉じる）は見ていない。関節が欠けた指は 0（開いた手）にする
 */
export function computeFingerCurls(
  getPosition: JointPositionLookup,
  out: FingerCurls = { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
  handedness?: 'left' | 'right',
): FingerCurls {
  for (const finger of FINGER_NAMES) {
    const bend = measureFingerBend(finger, getPosition)
    out[finger] = bend === null ? 0 : toCurl(bend, CURL_RANGE[finger])
  }
  if (handedness) {
    const swing = measureThumbSwing(getPosition, handedness)
    if (swing !== null) out.thumb = Math.max(out.thumb, toCurl(swing, THUMB_SWING_RANGE))
  }
  return out
}

const _jointPositions = new Map<XRHandJoint, Vector3>()

/**
 * XR の手（XRHand）から、指ごとの曲がりを求める。関節が 1 つも取れなければ null
 * @param baseSpace 関節の位置を測る空間（XR の基準空間など。曲がりは座標系によらない）
 * @param handedness 手の左右（XRInputSource.handedness）。渡すと親指の回り込みも見る
 */
export function readHandFingerCurls(
  frame: XRFrame,
  hand: XRHand,
  baseSpace: XRSpace,
  out?: FingerCurls,
  handedness?: 'left' | 'right',
): FingerCurls | null {
  if (!readJointPositions(frame, hand, baseSpace)) return null
  return computeFingerCurls((joint) => _jointPositions.get(joint), out, handedness)
}

/**
 * XR の手から、指ごとの曲がりと指の開きを一度に求める。関節が 1 つも取れなければ false
 * @param out 結果を書き込む先（curls・spread）
 */
export function readHandFingers(
  frame: XRFrame,
  hand: XRHand,
  baseSpace: XRSpace,
  handedness: 'left' | 'right',
  out: { curls: FingerCurls; spread: FingerSpread },
): boolean {
  if (!readJointPositions(frame, hand, baseSpace)) return false
  const getPosition = (joint: XRHandJoint) => _jointPositions.get(joint)
  computeFingerCurls(getPosition, out.curls, handedness)
  if (!computeFingerSpread(getPosition, out.spread)) {
    out.spread.index = 0
    out.spread.ring = 0
    out.spread.little = 0
  }
  return true
}

/** 手の関節の位置を読んで覚える（_jointPositions）。1 つも取れなければ false */
function readJointPositions(frame: XRFrame, hand: XRHand, baseSpace: XRSpace): boolean {
  if (!frame.getJointPose) return false
  let found = 0
  for (const chain of [['wrist'] as const, ...Object.values(FINGER_CHAINS)]) {
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
  return found > 0
}
