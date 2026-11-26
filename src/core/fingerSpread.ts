import { Quaternion, Vector3 } from 'three'
import type { JointPositionLookup } from './handFingerCurl.js'
import type { FingerSpread, SpreadFingerName } from './types.js'

export const SPREAD_FINGERS: readonly SpreadFingerName[] = ['index', 'ring', 'little']

const SPREAD_JOINTS: Record<SpreadFingerName, readonly [XRHandJoint, XRHandJoint]> = {
  index: ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate'],
  ring: ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate'],
  little: ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate'],
}

/** 開きの範囲（度）。人の指が開ける範囲くらいで止める（トラッキングの乱れで指が真横を向かないように） */
const SPREAD_LIMITS: Record<SpreadFingerName, readonly [number, number]> = {
  index: [-10, 30],
  ring: [-25, 10],
  little: [-40, 15],
}

/**
 * 指の根元の骨が、手のひらの面からどれだけ外れたら開きを測らないか（面に乗っている長さの割合）。
 * 曲げた指は手のひらの側を向くので、面に乗る長さが短くなり、角度が乱れる
 */
const MIN_IN_PLANE_RATIO = 0.5

const _finger = new Vector3()
const _side = new Vector3()
const _bone = new Vector3()

/** 指の根元の骨（基節）の、手のひらの面での向き（度。親指の側が +）。測れなければ null */
function measureBoneAngle(
  joints: readonly [XRHandJoint, XRHandJoint],
  getPosition: JointPositionLookup,
): number | null {
  const base = getPosition(joints[0])
  const next = getPosition(joints[1])
  if (!base || !next) return null
  _bone.subVectors(next, base)
  const length = _bone.length()
  if (length < 1e-6) return null
  const along = _bone.dot(_finger)
  const aside = _bone.dot(_side)
  if (Math.hypot(along, aside) / length < MIN_IN_PLANE_RATIO) return null
  return (Math.atan2(aside, along) * 180) / Math.PI
}

/**
 * 手の関節の位置から、指の開き（度）を求める。手のひらが決まらなければ null
 *
 * 手のひらの面（手首→中指の付け根の向きと、小指→人差し指の付け根の向き）で、各指の根元の骨の向きを
 * 中指の根元の骨と比べる（中指を曲げていれば手のひらの向きと比べる）。
 * 曲げて手のひらの側を向いた指は測れないので 0（そろえたまま）にする
 */
export function computeFingerSpread(
  getPosition: JointPositionLookup,
  out: FingerSpread = { index: 0, ring: 0, little: 0 },
): FingerSpread | null {
  const wrist = getPosition('wrist')
  const middle = getPosition('middle-finger-phalanx-proximal')
  const index = getPosition('index-finger-phalanx-proximal')
  const pinky = getPosition('pinky-finger-phalanx-proximal')
  if (!wrist || !middle || !index || !pinky) return null
  _finger.subVectors(middle, wrist)
  _side.subVectors(index, pinky)
  if (_finger.lengthSq() < 1e-12) return null
  _finger.normalize()
  _side.addScaledVector(_finger, -_side.dot(_finger))
  if (_side.lengthSq() < 1e-12) return null
  _side.normalize()

  // 中指を曲げている（チョキ・指さしなど）ときは測れないので、手のひらの向き（0°）を基準にする
  const middleAngle =
    measureBoneAngle(
      ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate'],
      getPosition,
    ) ?? 0
  for (const finger of SPREAD_FINGERS) {
    const angle = measureBoneAngle(SPREAD_JOINTS[finger], getPosition)
    const [min, max] = SPREAD_LIMITS[finger]
    out[finger] = angle === null ? 0 : Math.min(max, Math.max(min, angle - middleAngle))
  }
  return out
}

const AXIS_Y = new Vector3(0, 1, 0)

/**
 * 指の開きを、アバターの指の根元のボーン（Proximal）に当てる回転にする
 *
 * VRM 1.0 の正規化した手は手のひらが -Y・親指の側が +Z（右手は指先 -X、左手は +X）なので、
 * Y 軸まわりに回す。左右で向きが逆。曲げた指ほど弱める（握った指が横に広がらないように）
 * @param degrees 開き（度。親指の側が +）
 * @param curl その指の曲がり（0〜1）
 */
export function getSpreadRotation(
  side: 'left' | 'right',
  degrees: number,
  curl: number,
  out: Quaternion,
): Quaternion {
  const sign = side === 'right' ? 1 : -1
  const fade = 1 - Math.min(1, Math.max(0, curl))
  return out.setFromAxisAngle(AXIS_Y, (sign * degrees * fade * Math.PI) / 180)
}
